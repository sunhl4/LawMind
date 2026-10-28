/**
 * 收件库：`<workspace>/lawmind/intake/`。
 *
 *   items/<id>.json      每条来件一份，真相源
 *   blobs/<aa>/<sha256>  附件与超长正文的原件，按内容寻址
 *   events.jsonl         入库 / 判案 / 归档 / 撤回 / 忽略的流水
 *   keys.json            去重与待归档索引（可由 items/ 重建）
 *   threads.json         邮件线程 → 案件（可由已归档条目重建）
 *   state.json           各收案邮箱上次同步时间
 *
 * 写 items / keys / threads 一律持同一把锁；锁不可重入，回调里不要再调本文件的写函数。
 * 这个目录在 agent 工作区读写黑名单里（lawmind/），模型读不到未归档的来件。
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appendJsonl,
  readJsonl,
  withExclusiveFileLock,
  writeJsonAtomic,
} from "../adapters/matter-storage/io.js";
import {
  INTAKE_ITEM_ID_RE,
  IntakeEventSchema,
  IntakeItemSchema,
  type IntakeEvent,
  type IntakeItem,
  type IntakeStatus,
  type NewIntakeItem,
} from "./types.js";

const TEXT_CAP = 20_000;
const SHA256_RE = /^[a-f0-9]{64}$/;

const KeyIndexSchema = z.object({
  schemaVersion: z.literal(1),
  byExternalKey: z.record(z.string(), z.string()),
  byMessageId: z.record(z.string(), z.string()),
  pending: z.array(z.string()),
});
type KeyIndex = z.infer<typeof KeyIndexSchema>;

const ThreadIndexSchema = z.object({
  schemaVersion: z.literal(1),
  refs: z.record(z.string(), z.string()),
});

const IntakeMailCursorSchema = z.object({
  /** 首次水位已建立：即使邮箱为空也不会把下一轮当成首次同步。 */
  initializedAt: z.string().optional(),
  attemptedAt: z.string().optional(),
  syncedAt: z.string().optional(),
  error: z.string().max(240).optional(),
  /** IMAP 水位：UIDVALIDITY 不变时从 lastUid 之后接着拉。 */
  uidValidity: z.string().max(40).optional(),
  lastUid: z.number().int().nonnegative().optional(),
  /** Graph 水位：只取此刻之后（含）收到的信。 */
  receivedSince: z.string().optional(),
  /** 批处理是否仍有未取完的 Graph 页面。 */
  graphNextLink: z.string().max(4096).optional(),
  /** 仅首次同步使用的查询下界；成功写入后不持久化。 */
  bootstrapSince: z.string().optional(),
});
export type IntakeMailCursor = z.infer<typeof IntakeMailCursorSchema>;

const IntakeStateSchema = z.object({
  schemaVersion: z.literal(1),
  mail: z.record(z.string(), IntakeMailCursorSchema),
  dropzoneScanAt: z.string().optional(),
});
export type IntakeState = z.infer<typeof IntakeStateSchema>;

export function intakeRoot(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "intake");
}

function itemsDir(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "items");
}

function itemPath(workspaceDir: string, id: string): string {
  return path.join(itemsDir(workspaceDir), `${id}.json`);
}

function lockPath(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), ".lock");
}

function keysPath(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "keys.json");
}

function threadsPath(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "threads.json");
}

function eventsPath(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "events.jsonl");
}

function statePath(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "state.json");
}

function withIntakeLock<T>(workspaceDir: string, fn: () => T): T {
  return withExclusiveFileLock(lockPath(workspaceDir), fn);
}

export function isIntakeItemId(id: string): boolean {
  return INTAKE_ITEM_ID_RE.test(id);
}

/** 文件名按入库时间排序：base36 毫秒数在 2059 年前都是 8 位。 */
function newIntakeItemId(): string {
  return `it-${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

/** Message-ID / In-Reply-To 的比对形式：去尖括号与空白，小写。 */
export function normalizeMessageRef(raw: string): string {
  return raw.trim().replace(/^<+/, "").replace(/>+$/, "").trim().toLowerCase();
}

function readJsonOrUndefined<T>(filePath: string, schema: z.ZodType<T>): T | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readItemFile(workspaceDir: string, id: string): IntakeItem | undefined {
  if (!isIntakeItemId(id)) {
    return undefined;
  }
  return readJsonOrUndefined(itemPath(workspaceDir, id), IntakeItemSchema);
}

function listItemIdsDesc(workspaceDir: string): string[] {
  const dir = itemsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter(isIntakeItemId)
    .toSorted()
    .toReversed();
}

function rebuildKeyIndex(workspaceDir: string): KeyIndex {
  const index: KeyIndex = { schemaVersion: 1, byExternalKey: {}, byMessageId: {}, pending: [] };
  for (const id of listItemIdsDesc(workspaceDir).toReversed()) {
    const item = readItemFile(workspaceDir, id);
    if (!item) {
      continue;
    }
    index.byExternalKey[item.externalKey] = item.id;
    if (item.thread?.messageId) {
      index.byMessageId[normalizeMessageRef(item.thread.messageId)] = item.id;
    }
    if (item.status === "pending") {
      index.pending.push(item.id);
    }
  }
  return index;
}

function loadKeyIndex(workspaceDir: string): KeyIndex {
  return (
    readJsonOrUndefined(keysPath(workspaceDir), KeyIndexSchema) ?? rebuildKeyIndex(workspaceDir)
  );
}

function setPending(index: KeyIndex, id: string, pending: boolean): void {
  const rest = index.pending.filter((row) => row !== id);
  index.pending = pending ? [...rest, id] : rest;
}

function clip(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function putIntakeBlob(workspaceDir: string, content: Buffer): string {
  const sha256 = createHash("sha256").update(content).digest("hex");
  const target = intakeBlobPath(workspaceDir, sha256);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, target);
  }
  return sha256;
}

export function intakeBlobPath(workspaceDir: string, sha256: string): string {
  if (!SHA256_RE.test(sha256)) {
    throw new Error("invalid intake blob id");
  }
  return path.join(intakeRoot(workspaceDir), "blobs", sha256.slice(0, 2), sha256);
}

export function readIntakeBlob(workspaceDir: string, sha256: string): Buffer | undefined {
  if (!SHA256_RE.test(sha256)) {
    return undefined;
  }
  try {
    return fs.readFileSync(intakeBlobPath(workspaceDir, sha256));
  } catch {
    return undefined;
  }
}

/** 来件全文：超长正文从原件取回，否则就是 text。 */
export function intakeItemFullText(workspaceDir: string, item: IntakeItem): string {
  if (item.bodySha256) {
    const blob = readIntakeBlob(workspaceDir, item.bodySha256);
    if (blob) {
      return blob.toString("utf8");
    }
  }
  return item.text;
}

export function appendIntakeEvent(workspaceDir: string, event: IntakeEvent): void {
  appendJsonl(eventsPath(workspaceDir), IntakeEventSchema, event);
}

export function readIntakeEvents(workspaceDir: string, opts?: { limit?: number }): IntakeEvent[] {
  const all = readJsonl(eventsPath(workspaceDir), IntakeEventSchema);
  const limit = opts?.limit;
  return typeof limit === "number" && limit >= 0 ? all.slice(-limit) : all;
}

/**
 * 幂等入库：同一渠道去重键或同一 Message-ID 已入库时返回原条目（created=false）。
 */
export function recordIntakeItem(
  workspaceDir: string,
  input: NewIntakeItem,
  opts?: { now?: Date },
): { item: IntakeItem; created: boolean } {
  const now = (opts?.now ?? new Date()).toISOString();
  const externalKey = input.externalKey.trim().slice(0, 512);
  const messageId = input.thread?.messageId ? normalizeMessageRef(input.thread.messageId) : "";
  const fullText = input.text ?? "";
  const bodySha256 =
    fullText.length > TEXT_CAP ? putIntakeBlob(workspaceDir, Buffer.from(fullText, "utf8")) : "";
  return withIntakeLock(workspaceDir, () => {
    const keys = loadKeyIndex(workspaceDir);
    const existingId =
      keys.byExternalKey[externalKey] ?? (messageId ? keys.byMessageId[messageId] : undefined);
    const existing = existingId ? readItemFile(workspaceDir, existingId) : undefined;
    if (existing) {
      return { item: existing, created: false };
    }
    const fromDisplay = clip(input.from?.display, 320);
    const fromAddress = clip(input.from?.address, 254)?.toLowerCase();
    const inReplyTo = (input.thread?.inReplyTo ?? []).map(normalizeMessageRef).filter(Boolean);
    const references = (input.thread?.references ?? []).map(normalizeMessageRef).filter(Boolean);
    const conversationId = clip(input.thread?.conversationId, 512);
    const thread = {
      ...(messageId ? { messageId: messageId.slice(0, 998) } : {}),
      ...(inReplyTo.length > 0 ? { inReplyTo: inReplyTo.slice(0, 20) } : {}),
      ...(references.length > 0 ? { references: references.slice(-50) } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    const item = IntakeItemSchema.parse({
      schemaVersion: 1,
      id: newIntakeItemId(),
      channel: input.channel,
      externalKey,
      trust: "untrusted",
      receivedAt: input.receivedAt || now,
      recordedAt: now,
      ...(fromDisplay || fromAddress
        ? {
            from: {
              display: fromDisplay ?? fromAddress ?? "",
              ...(fromAddress ? { address: fromAddress } : {}),
            },
          }
        : {}),
      ...(clip(input.to, 2000) ? { to: clip(input.to, 2000) } : {}),
      ...(clip(input.subject, 500) ? { subject: clip(input.subject, 500) } : {}),
      text: fullText.slice(0, TEXT_CAP),
      ...(bodySha256 ? { bodySha256 } : {}),
      ...(Object.keys(thread).length > 0 ? { thread } : {}),
      ...(input.dmarc ? { dmarc: input.dmarc } : {}),
      attachments: input.attachments.slice(0, 50).map((att) => ({
        ...att,
        name: att.name.trim().slice(0, 255) || "附件",
      })),
      ...(input.source ? { source: input.source } : {}),
      status: "pending",
    });
    writeJsonAtomic(itemPath(workspaceDir, item.id), item);
    keys.byExternalKey[externalKey] = item.id;
    if (messageId) {
      keys.byMessageId[messageId] = item.id;
    }
    setPending(keys, item.id, true);
    writeJsonAtomic(keysPath(workspaceDir), keys);
    appendIntakeEvent(workspaceDir, { at: now, itemId: item.id, kind: "recorded", by: "system" });
    return { item, created: true };
  });
}

export function getIntakeItem(workspaceDir: string, id: string): IntakeItem | undefined {
  return readItemFile(workspaceDir, id);
}

/** 只读查重（不持锁）：同步时先用它跳过已入库的信，省掉重复算附件哈希。 */
export function findIntakeItemId(
  workspaceDir: string,
  keys: { externalKey: string; messageId?: string },
): string | undefined {
  const index = loadKeyIndex(workspaceDir);
  const messageId = keys.messageId ? normalizeMessageRef(keys.messageId) : "";
  return (
    index.byExternalKey[keys.externalKey.trim()] ??
    (messageId ? index.byMessageId[messageId] : undefined)
  );
}

/**
 * 待归档直接走索引；其他状态按入库时间倒序扫，凑够 limit 为止。
 */
export function listIntakeItems(
  workspaceDir: string,
  opts?: { statuses?: IntakeStatus[]; limit?: number },
): IntakeItem[] {
  const statuses = new Set(opts?.statuses ?? ["pending", "attached", "ignored"]);
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const onlyPending = statuses.size === 1 && statuses.has("pending");
  const ids = onlyPending
    ? loadKeyIndex(workspaceDir).pending.toSorted().toReversed()
    : listItemIdsDesc(workspaceDir);
  const out: IntakeItem[] = [];
  for (const id of ids) {
    const item = readItemFile(workspaceDir, id);
    if (item && statuses.has(item.status)) {
      out.push(item);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}

/** 持锁读-改-写一条来件。mutate 返回 undefined 表示不写。 */
export function updateIntakeItem(
  workspaceDir: string,
  id: string,
  mutate: (item: IntakeItem) => IntakeItem | undefined,
): IntakeItem | undefined {
  if (!isIntakeItemId(id)) {
    return undefined;
  }
  return withIntakeLock(workspaceDir, () => {
    const current = readItemFile(workspaceDir, id);
    if (!current) {
      return undefined;
    }
    const next = mutate(structuredClone(current));
    if (!next) {
      return undefined;
    }
    const parsed = IntakeItemSchema.parse({ ...next, id: current.id });
    writeJsonAtomic(itemPath(workspaceDir, id), parsed);
    if (parsed.status !== current.status) {
      const keys = loadKeyIndex(workspaceDir);
      setPending(keys, id, parsed.status === "pending");
      writeJsonAtomic(keysPath(workspaceDir), keys);
    }
    return parsed;
  });
}

/** 这条来件归档后，同一线程的后续回信凭哪些引用认回本案。 */
export function intakeThreadRefs(item: IntakeItem): string[] {
  const refs = new Set<string>();
  if (item.thread?.messageId) {
    refs.add(normalizeMessageRef(item.thread.messageId));
  }
  for (const ref of [...(item.thread?.inReplyTo ?? []), ...(item.thread?.references ?? [])]) {
    const normalized = normalizeMessageRef(ref);
    if (normalized) {
      refs.add(normalized);
    }
  }
  if (item.thread?.conversationId && item.source?.accountId) {
    refs.add(`conv:${item.source.accountId}:${item.thread.conversationId}`);
  }
  return [...refs];
}

/** 来件自身能拿来查线程表的引用（不含它自己的 Message-ID）。 */
export function intakeLookupRefs(item: IntakeItem): string[] {
  const own = item.thread?.messageId ? normalizeMessageRef(item.thread.messageId) : "";
  return intakeThreadRefs(item).filter((ref) => ref !== own);
}

function rebuildThreadIndex(workspaceDir: string): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of listItemIdsDesc(workspaceDir).toReversed()) {
    const item = readItemFile(workspaceDir, id);
    if (item?.status === "attached" && item.filing) {
      for (const ref of intakeThreadRefs(item)) {
        refs[ref] = item.filing.matterId;
      }
    }
  }
  return refs;
}

export function readIntakeThreadRefs(workspaceDir: string): Record<string, string> {
  return (
    readJsonOrUndefined(threadsPath(workspaceDir), ThreadIndexSchema)?.refs ??
    rebuildThreadIndex(workspaceDir)
  );
}

const THREAD_REFS_CAP = 50_000;

function writeThreadRefs(workspaceDir: string, refs: Record<string, string>): void {
  const keys = Object.keys(refs);
  const kept =
    keys.length > THREAD_REFS_CAP
      ? Object.fromEntries(keys.slice(-THREAD_REFS_CAP).map((k) => [k, refs[k]]))
      : refs;
  writeJsonAtomic(threadsPath(workspaceDir), { schemaVersion: 1, refs: kept });
}

/** 发出的信记进线程表：对方回信时凭 In-Reply-To 认回本案。 */
export function rememberIntakeThreadRef(workspaceDir: string, ref: string, matterId: string): void {
  const normalized = normalizeMessageRef(ref);
  if (!normalized || !matterId.trim()) {
    return;
  }
  withIntakeLock(workspaceDir, () => {
    const refs = readIntakeThreadRefs(workspaceDir);
    delete refs[normalized];
    refs[normalized] = matterId;
    writeThreadRefs(workspaceDir, refs);
  });
}

/**
 * 归档 / 撤回落盘：条目状态与线程表在同一把锁里改，避免线程表指向已撤回的案件。
 */
export function commitIntakeFiling(
  workspaceDir: string,
  id: string,
  mutate: (item: IntakeItem) => IntakeItem | undefined,
): IntakeItem | undefined {
  if (!isIntakeItemId(id)) {
    return undefined;
  }
  return withIntakeLock(workspaceDir, () => {
    const current = readItemFile(workspaceDir, id);
    if (!current) {
      return undefined;
    }
    const next = mutate(structuredClone(current));
    if (!next) {
      return undefined;
    }
    const parsed = IntakeItemSchema.parse({ ...next, id: current.id });
    writeJsonAtomic(itemPath(workspaceDir, id), parsed);
    const keys = loadKeyIndex(workspaceDir);
    setPending(keys, id, parsed.status === "pending");
    writeJsonAtomic(keysPath(workspaceDir), keys);
    const refs = readIntakeThreadRefs(workspaceDir);
    const priorMatter = current.status === "attached" ? current.filing?.matterId : undefined;
    for (const ref of intakeThreadRefs(current)) {
      if (priorMatter && refs[ref] === priorMatter) {
        delete refs[ref];
      }
    }
    if (parsed.status === "attached" && parsed.filing) {
      for (const ref of intakeThreadRefs(parsed)) {
        delete refs[ref];
        refs[ref] = parsed.filing.matterId;
      }
    }
    writeThreadRefs(workspaceDir, refs);
    return parsed;
  });
}

export function readIntakeState(workspaceDir: string): IntakeState {
  return (
    readJsonOrUndefined(statePath(workspaceDir), IntakeStateSchema) ?? {
      schemaVersion: 1,
      mail: {},
    }
  );
}

export function updateIntakeState(
  workspaceDir: string,
  mutate: (state: IntakeState) => IntakeState,
): IntakeState {
  return withIntakeLock(workspaceDir, () => {
    const next = IntakeStateSchema.parse(mutate(structuredClone(readIntakeState(workspaceDir))));
    writeJsonAtomic(statePath(workspaceDir), next);
    return next;
  });
}
