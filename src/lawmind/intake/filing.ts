/**
 * 归档 / 撤回 / 忽略。
 *
 * 归档 = 把来件物化进案件目录（邮件进 cases/<id>/mail/inbox，投递文件进 cases/<id>/materials），
 * 之后案件里的一切（办件、检索、对话）照旧读这些路径。撤回只删本次物化、且未被律师改过的文件。
 */

import fs from "node:fs";
import path from "node:path";
import { loadMatter } from "../adapters/matter-storage/index.js";
import {
  addMatterPartyContact,
  removeMatterPartyContact,
} from "../application/services/matter-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { matterMaterialsDir } from "../desk/matter-materials.js";
import { hydrateMatterParties, contactIdentityKey } from "../desk/matter-parties.js";
import {
  sanitizeMailMessageIdForPath,
  writeFetchedAttachments,
  type FetchedMailMessage,
} from "../mail/imap-client.js";
import {
  matterMailInboxDir,
  writeMatterMailMessage,
  type LocalMailMessage,
} from "../platform/lawyer-automations.js";
import { wakeMatterRunsForEvent } from "../platform/matter-run-store.js";
import {
  appendIntakeEvent,
  commitIntakeFiling,
  getIntakeItem,
  intakeItemFullText,
  readIntakeBlob,
  updateIntakeItem,
} from "./store.js";
import type { IntakeItem, IntakeKey } from "./types.js";

export type IntakeFilingError =
  | "not_found"
  | "invalid_matter"
  | "matter_not_found"
  | "already_filed"
  | "not_filed"
  | "not_pending";

export type IntakeFilingResult =
  | {
      ok: true;
      item: IntakeItem;
      rememberedSender?: boolean;
      /** 同一邮箱已挂在别的当事人名下：没有重复登记，列出那些人。 */
      rememberSkippedParties?: string[];
    }
  | { ok: false; error: IntakeFilingError };

function rel(workspaceDir: string, abs: string): string {
  return path.relative(path.resolve(workspaceDir), abs).split(path.sep).join("/");
}

/**
 * 开件归档成功 → 唤醒等在这个案件上的 MatterRun（例如等客户补件）。
 *
 * 唤醒是「归档已提交」之后的附加动作：失败只影响恢复速度，不能反向把归档打挂。
 * `intake:<id>` 用于精确等待某一条来件，`matter:<id>` 用于等该案任何新材料。
 */
function wakeRunsForFiling(
  workspaceDir: string,
  matterId: string,
  itemId: string,
  at: string,
): void {
  for (const eventKey of [`matter:${matterId}`, `intake:${itemId}`]) {
    try {
      wakeMatterRunsForEvent(workspaceDir, eventKey, { matterId, at });
    } catch {
      /* best-effort：运行唤醒不是归档的前置条件 */
    }
  }
}

function safeFileName(name: string, fallback: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).normalize("NFC");
  const cleaned = base
    .replace(/[\p{Cc}<>:"|?*]+/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** 同名不同内容加序号；同名同内容视为已在（重复归档不复制第二份）。 */
function placeMaterial(dir: string, name: string, content: Buffer): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length) || "材料";
  for (let n = 1; n < 100; n += 1) {
    const candidate = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!fs.existsSync(candidate)) {
      fs.writeFileSync(candidate, content, { flag: "wx" });
      return candidate;
    }
    if (fs.readFileSync(candidate).equals(content)) {
      return candidate;
    }
  }
  throw new Error("material_name_exhausted");
}

function transcriptClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function transcriptMaterialName(item: IntakeItem): string {
  const audio = item.attachments[0]?.name ?? "";
  const stem = audio.replace(/\.[a-z0-9]+$/i, "").trim();
  return `${stem || "录音"} 转写.txt`;
}

/**
 * 归档时的转写稿文本。说话人名字优先用案件当事人（仅当映射就在本案），
 * 其次 `speakerLabels`，最后原始说话人键。
 */
function renderTranscriptText(
  item: IntakeItem,
  speakerNames?: { matterId: string; partyNames: Map<string, string> },
): string | null {
  const text = item.text.trim();
  if (!text) {
    return null;
  }
  const lines = [
    "# 录音转写",
    "",
    `- 来源：${item.attachments[0]?.name ?? "(未命名录音)"}`,
    `- 收到：${item.receivedAt}`,
    "- 说明：自动转写，未经逐字校对；时间戳用于回听定位。",
    ...(item.transcript?.editedAt ? ["- 校对：律师已修改分段文字。"] : []),
    "",
  ];
  const segments = item.transcript?.segments ?? [];
  if (segments.length > 0) {
    const labels = item.transcript?.speakerLabels ?? {};
    for (const segment of segments) {
      const clock = segment.startMs === undefined ? "" : `[${transcriptClock(segment.startMs)}] `;
      const mapped = segment.speaker
        ? item.transcript?.speakerParties?.[segment.speaker]
        : undefined;
      const partyName =
        mapped && speakerNames && mapped.matterId === speakerNames.matterId
          ? speakerNames.partyNames.get(mapped.partyId)
          : undefined;
      const name = segment.speaker
        ? `${partyName ?? labels[segment.speaker] ?? segment.speaker}：`
        : "";
      const edited = segment.editedAt ? " 〔律师改正〕" : "";
      lines.push(`${clock}${name}${segment.text}${edited}`);
    }
  } else {
    lines.push(text);
  }
  lines.push("");
  return lines.join("\n");
}

function partyNamesForMatter(workspaceDir: string, matterId: string): Map<string, string> {
  const record = loadMatter(workspaceDir, matterId);
  return new Map(
    (record ? hydrateMatterParties(record) : []).map((party) => [party.partyId, party.name]),
  );
}

function materializeEmail(workspaceDir: string, item: IntakeItem, matterId: string): string[] {
  const mailId = item.source?.providerMessageId || item.id;
  const blobs: FetchedMailMessage["attachments"] = [];
  const skipped: LocalMailMessage["attachments"] = [];
  for (const att of item.attachments) {
    const content = att.sha256 ? readIntakeBlob(workspaceDir, att.sha256) : undefined;
    if (content) {
      blobs.push({
        name: att.name,
        content,
        ...(att.contentType ? { contentType: att.contentType } : {}),
      });
    } else {
      skipped.push({ name: att.name });
    }
  }
  const refs = writeFetchedAttachments(workspaceDir, matterId, mailId, blobs);
  const message: LocalMailMessage & { intakeItemId: string; messageId?: string } = {
    id: mailId,
    from: item.from?.display ?? item.from?.address ?? "unknown",
    to: item.to ?? "",
    subject: item.subject ?? "(无主题)",
    receivedAt: item.receivedAt,
    bodyText: intakeItemFullText(workspaceDir, item),
    attachments: [...refs, ...skipped],
    intakeItemId: item.id,
    ...(item.thread?.messageId ? { messageId: item.thread.messageId } : {}),
  };
  writeMatterMailMessage(workspaceDir, matterId, message);
  const inboxFile = path.join(
    matterMailInboxDir(workspaceDir, matterId),
    `${sanitizeMailMessageIdForPath(mailId)}.json`,
  );
  return [
    rel(workspaceDir, inboxFile),
    ...refs
      .filter((r) => r.relativePath)
      .map((r) => `cases/${matterId}/${String(r.relativePath).split(path.sep).join("/")}`),
  ];
}

function materializeFiles(workspaceDir: string, item: IntakeItem, matterId: string): string[] {
  const dir = matterMaterialsDir(workspaceDir, matterId);
  fs.mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  item.attachments.forEach((att, i) => {
    const content = att.sha256 ? readIntakeBlob(workspaceDir, att.sha256) : undefined;
    if (!content) {
      return;
    }
    out.push(
      rel(workspaceDir, placeMaterial(dir, safeFileName(att.name, `材料-${i + 1}`), content)),
    );
  });
  if (item.channel === "recording") {
    const transcript = renderTranscriptText(item, {
      matterId,
      partyNames: partyNamesForMatter(workspaceDir, matterId),
    });
    if (transcript) {
      out.push(
        rel(
          workspaceDir,
          placeMaterial(
            dir,
            safeFileName(transcriptMaterialName(item), "录音转写.txt"),
            Buffer.from(transcript, "utf8"),
          ),
        ),
      );
    }
  }
  return out;
}

function materialize(workspaceDir: string, item: IntakeItem, matterId: string): string[] {
  return item.channel === "email"
    ? materializeEmail(workspaceDir, item, matterId)
    : materializeFiles(workspaceDir, item, matterId);
}

/** 记住发件人时默认挂在委托人名下：待归案里主要是委托人寄来的材料。 */
function rememberPartyId(
  workspaceDir: string,
  matterId: string,
  explicit?: { partyId: string },
): string | undefined {
  if (explicit?.partyId?.trim()) {
    return explicit.partyId.trim();
  }
  const record = loadMatter(workspaceDir, matterId);
  if (!record) {
    return undefined;
  }
  const parties = hydrateMatterParties(record);
  return parties.find((party) => party.role === "client" && party.name.trim())?.partyId;
}

export function attachIntakeItem(
  workspaceDir: string,
  itemId: string,
  matterId: string,
  opts: {
    by: "system" | "lawyer";
    keys?: IntakeKey[];
    /** 律师确认归档时记住发件人：写成该当事人的已核验邮箱，下次同一发件人自动归档。 */
    rememberSenderAs?: { partyId: string };
    /** 不指定 partyId 时记到本案委托人名下；本案没有委托人就不记。 */
    rememberSender?: boolean;
    now?: Date;
  },
): IntakeFilingResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (!isValidMatterId(matterId)) {
    return { ok: false, error: "invalid_matter" };
  }
  if (!loadMatter(workspaceDir, matterId)) {
    return { ok: false, error: "matter_not_found" };
  }
  if (item.status === "attached") {
    return item.filing?.matterId === matterId
      ? { ok: true, item }
      : { ok: false, error: "already_filed" };
  }
  if (opts.by === "system" && item.status !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  const at = (opts.now ?? new Date()).toISOString();
  const materialized = materialize(workspaceDir, item, matterId);
  const filed = commitIntakeFiling(workspaceDir, itemId, (current) => {
    if (current.status === "attached") {
      return undefined;
    }
    const next: IntakeItem = {
      ...current,
      status: "attached",
      filing: { matterId, by: opts.by, at, keys: (opts.keys ?? []).slice(0, 12), materialized },
    };
    delete next.ignoredAt;
    return next;
  });
  if (!filed) {
    const now = getIntakeItem(workspaceDir, itemId);
    return now?.status === "attached" && now.filing?.matterId === matterId
      ? { ok: true, item: now }
      : { ok: false, error: "already_filed" };
  }
  appendIntakeEvent(workspaceDir, {
    at,
    itemId,
    kind: "attached",
    by: opts.by,
    matterId,
    ...(opts.keys?.[0] ? { detail: opts.keys[0].detail } : {}),
  });
  wakeRunsForFiling(workspaceDir, matterId, itemId, at);
  let rememberedSender: boolean | undefined;
  let rememberSkippedParties: string[] | undefined;
  const remember =
    opts.rememberSender === true || opts.rememberSenderAs
      ? rememberPartyId(workspaceDir, matterId, opts.rememberSenderAs)
      : undefined;
  if (remember && item.from?.address) {
    const candidate = {
      kind: "email" as const,
      value: item.from.address,
      ...(item.source?.accountId ? { account: item.source.accountId } : {}),
    };
    const identity = contactIdentityKey(candidate);
    // 同一身份已经在别的当事人名下：再写一条就是 P2.18 报的「重复联系方式」。
    // 不静默合并当事人，也不假装记住；把占用的当事人名字交回给界面说明。
    const record = loadMatter(workspaceDir, matterId);
    const owners = record
      ? hydrateMatterParties(record).filter(
          (party) =>
            party.partyId !== remember &&
            (party.contacts ?? []).some((contact) => contactIdentityKey(contact) === identity),
        )
      : [];
    if (owners.length > 0) {
      rememberedSender = false;
      rememberSkippedParties = owners.map((party) => party.name.trim() || party.partyId);
    } else {
      rememberedSender = Boolean(
        addMatterPartyContact(workspaceDir, {
          matterId,
          partyId: remember,
          contact: {
            ...candidate,
            verified: true,
            source: "intake_confirmed",
            addedAt: at,
          },
        }),
      );
    }
  }
  return {
    ok: true,
    item: filed,
    ...(rememberedSender !== undefined ? { rememberedSender } : {}),
    ...(rememberSkippedParties ? { rememberSkippedParties } : {}),
  };
}

function removeIfUnchanged(
  workspaceDir: string,
  relPath: string,
  item: IntakeItem,
  transcriptText: string | null,
): void {
  const abs = path.resolve(workspaceDir, relPath);
  const casesRoot = path.join(path.resolve(workspaceDir), "cases") + path.sep;
  if (!abs.startsWith(casesRoot) || !fs.existsSync(abs)) {
    return;
  }
  if (!relPath.includes("/mail/")) {
    const content = fs.readFileSync(abs);
    const ours =
      item.attachments.some((att) => {
        const blob = att.sha256 ? readIntakeBlob(workspaceDir, att.sha256) : undefined;
        return blob?.equals(content) === true;
      }) ||
      (transcriptText !== null &&
        path.basename(abs).endsWith("转写.txt") &&
        content.equals(Buffer.from(transcriptText, "utf8")));
    if (!ours) {
      return;
    }
  }
  fs.rmSync(abs, { force: true });
}

/** 撤回归档：回到待归档，删掉本次物化的文件；可选同时忘记发件人。 */
export function detachIntakeItem(
  workspaceDir: string,
  itemId: string,
  opts?: { forgetSender?: boolean; now?: Date },
): IntakeFilingResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "attached" || !item.filing) {
    return { ok: false, error: "not_filed" };
  }
  const matterId = item.filing.matterId;
  const transcriptText =
    item.channel === "recording"
      ? renderTranscriptText(item, {
          matterId,
          partyNames: partyNamesForMatter(workspaceDir, matterId),
        })
      : null;
  for (const relPath of item.filing.materialized) {
    try {
      removeIfUnchanged(workspaceDir, relPath, item, transcriptText);
    } catch {
      /* 删不掉的留给律师处理 */
    }
  }
  const at = (opts?.now ?? new Date()).toISOString();
  const updated = commitIntakeFiling(workspaceDir, itemId, (current) => {
    if (current.status !== "attached") {
      return undefined;
    }
    const next: IntakeItem = { ...current, status: "pending" };
    delete next.filing;
    return next;
  });
  if (!updated) {
    return { ok: false, error: "not_filed" };
  }
  appendIntakeEvent(workspaceDir, { at, itemId, kind: "detached", by: "lawyer", matterId });
  if (opts?.forgetSender && item.from?.address) {
    removeMatterPartyContact(workspaceDir, {
      matterId,
      kind: "email",
      value: item.from.address,
      ...(item.source?.accountId ? { account: item.source.accountId } : {}),
    });
  }
  return { ok: true, item: updated };
}

export function ignoreIntakeItem(
  workspaceDir: string,
  itemId: string,
  opts?: { now?: Date },
): IntakeFilingResult {
  const at = (opts?.now ?? new Date()).toISOString();
  const updated = updateIntakeItem(workspaceDir, itemId, (current) =>
    current.status === "pending" ? { ...current, status: "ignored", ignoredAt: at } : undefined,
  );
  if (!updated) {
    return { ok: false, error: getIntakeItem(workspaceDir, itemId) ? "not_pending" : "not_found" };
  }
  appendIntakeEvent(workspaceDir, { at, itemId, kind: "ignored", by: "lawyer" });
  return { ok: true, item: updated };
}

export function restoreIntakeItem(
  workspaceDir: string,
  itemId: string,
  opts?: { now?: Date },
): IntakeFilingResult {
  const at = (opts?.now ?? new Date()).toISOString();
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (current.status !== "ignored") {
      return undefined;
    }
    const next: IntakeItem = { ...current, status: "pending" };
    delete next.ignoredAt;
    return next;
  });
  if (!updated) {
    return { ok: false, error: getIntakeItem(workspaceDir, itemId) ? "not_pending" : "not_found" };
  }
  appendIntakeEvent(workspaceDir, { at, itemId, kind: "restored", by: "lawyer" });
  return { ok: true, item: updated };
}
