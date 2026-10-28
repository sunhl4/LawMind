/**
 * 收案记录（admission）——案件从 `intake` 进入 `active` 之前的唯一闸门。
 *
 * 为什么单独一层：
 * - 来件只证明「有人找过来」，不证明律所已经接案。冲突扫描、风险告知、
 *   AI 使用告知和负责人都是收案决定的一部分，不能靠 `matter.status` 一个字符串代替。
 * - 律师是唯一能接受或婉拒委托的人。模型可以填候选当事人和来源，但不能把
 *   `lawyer_review` 推到 `accepted`。
 * - 记录放在 `lawmind/intake/admissions/`（agent 工作区黑名单内），因为冲突命中
 *   会写出**别的案件**的编号和当事人；放进 `matters/<id>/` 等于把其他客户的信息
 *   交给本案的对话读。
 *
 * 状态机：
 *   prospective → conflict_pending → lawyer_review → accepted | declined
 *
 * 只有 `accepted` 才允许外发（`checkAdmissionGate`）。`declined` 不改案件状态，
 * 案件仍是 `intake`，等律师删除或另建。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { updateMatterStatus } from "../application/services/matter-write-service.js";
import {
  listQueueItemsForMatter,
  transitionQueueItem,
} from "../application/services/queue-write-service.js";
import { emit } from "../audit/index.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { scanPartyCandidates } from "../desk/intake-promote.js";
import { intakeRoot } from "./store.js";
import type { IntakeItem } from "./types.js";

export const AdmissionStatusSchema = z.enum([
  "prospective",
  "conflict_pending",
  "lawyer_review",
  "accepted",
  "declined",
]);
export type AdmissionStatus = z.infer<typeof AdmissionStatusSchema>;

export const AdmissionCandidateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(["client", "counterparty", "related", "unknown"]),
  source: z.enum(["intake", "lawyer"]),
  /** 来源来件；律师后补的候选没有 itemId。 */
  itemId: z.string().max(64).optional(),
  /** 原文标签（原告/被告/委托人…），不丢信息。 */
  label: z.string().trim().max(40).optional(),
});
export type AdmissionCandidate = z.infer<typeof AdmissionCandidateSchema>;

export const AdmissionConflictHitSchema = z.object({
  /** 命中的**其他**案件；只用于律师判断，不写进本案 matter.json。 */
  matterId: z.string().trim().min(1).max(128),
  matterTitle: z.string().trim().max(200).optional(),
  partyName: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(500),
  source: z.enum(["matter_record", "matter_index", "workspace_memory", "host_mount", "lawyer"]),
});
export type AdmissionConflictHit = z.infer<typeof AdmissionConflictHitSchema>;

export const AdmissionConflictSchema = z.object({
  status: z.enum(["pending", "clear", "hit"]),
  scannedAt: z.string().optional(),
  scannedBy: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  hits: z.array(AdmissionConflictHitSchema).max(50),
  /** 命中后律师仍决定接案时的书面理由；没有理由不能接受。 */
  overrideReason: z.string().trim().max(500).optional(),
  overrideBy: z.string().trim().max(120).optional(),
  overrideAt: z.string().optional(),
});
export type AdmissionConflict = z.infer<typeof AdmissionConflictSchema>;

export const AdmissionDisclosureSchema = z.object({
  status: z.enum(["missing", "acknowledged"]),
  at: z.string().optional(),
  by: z.string().trim().max(120).optional(),
});
export type AdmissionDisclosure = z.infer<typeof AdmissionDisclosureSchema>;

export const AdmissionDecisionSchema = z.object({
  kind: z.enum(["accept", "decline"]),
  by: z.string().trim().min(1).max(120),
  at: z.string(),
  note: z.string().trim().max(500).optional(),
});
export type AdmissionDecision = z.infer<typeof AdmissionDecisionSchema>;

export const AdmissionTimelineEntrySchema = z.object({
  at: z.string(),
  kind: z.enum([
    "created",
    "owner_assigned",
    "candidates_added",
    "scan_started",
    "scan_recorded",
    "disclosure_acknowledged",
    "accepted",
    "declined",
  ]),
  by: z.enum(["system", "lawyer"]),
  detail: z.string().max(500).optional(),
});
export type AdmissionTimelineEntry = z.infer<typeof AdmissionTimelineEntrySchema>;

export const ADMISSION_ID_RE = /^adm-[a-z0-9]{8,40}$/;

export const AdmissionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  admissionId: z.string().regex(ADMISSION_ID_RE),
  matterId: z.string().trim().min(1).max(128),
  matterTitle: z.string().trim().max(200).optional(),
  sourceItemIds: z.array(z.string().max(64)).max(50),
  candidates: z.array(AdmissionCandidateSchema).max(32),
  ownerLawyerId: z.string().trim().min(1).max(120).optional(),
  status: AdmissionStatusSchema,
  conflict: AdmissionConflictSchema,
  riskDisclosure: AdmissionDisclosureSchema,
  aiDisclosure: AdmissionDisclosureSchema,
  decision: AdmissionDecisionSchema.optional(),
  timeline: z.array(AdmissionTimelineEntrySchema).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdmissionRecord = z.infer<typeof AdmissionRecordSchema>;

export type AdmissionError =
  | "invalid_matter_id"
  | "matter_not_found"
  | "matter_not_intake"
  | "not_found"
  | "already_decided"
  | "conflict_pending"
  | "conflict_override_required"
  | "disclosures_missing"
  | "owner_missing"
  | "no_candidates"
  | "invalid_input";

export type AdmissionResult =
  | { ok: true; admission: AdmissionRecord }
  | { ok: false; error: AdmissionError };

export type AdmissionGateReason =
  | "matter_missing"
  | "admission_missing"
  | "prospective"
  | "conflict_pending"
  | "lawyer_review"
  | "declined";

export type AdmissionGate = {
  allowed: boolean;
  reason?: AdmissionGateReason;
  admission?: AdmissionRecord;
};

const DECIDED: ReadonlySet<AdmissionStatus> = new Set(["accepted", "declined"]);

export function admissionRoot(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "admissions");
}

export function admissionPath(workspaceDir: string, matterId: string): string {
  return path.join(admissionRoot(workspaceDir), `${matterId}.json`);
}

function admissionLockPath(workspaceDir: string): string {
  return path.join(admissionRoot(workspaceDir), ".lock");
}

function withAdmissionLock<T>(workspaceDir: string, fn: () => T): T {
  return withExclusiveFileLock(admissionLockPath(workspaceDir), fn);
}

function readAdmissionFile(workspaceDir: string, matterId: string): AdmissionRecord | undefined {
  try {
    const file = admissionPath(workspaceDir, matterId);
    if (!fs.existsSync(file)) {
      return undefined;
    }
    const parsed = AdmissionRecordSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function newAdmissionId(): string {
  return `adm-${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function audit(
  workspaceDir: string,
  record: AdmissionRecord,
  action: string,
  actorId: string | undefined,
): void {
  // 审计是 best-effort：收案决定本身已经写进 timeline，审计写失败不能让律师重做一遍。
  void emit(path.join(workspaceDir, "audit"), {
    taskId: "system",
    kind: "matter.admission",
    actor: "lawyer",
    ...(actorId ? { actorId } : {}),
    matterId: record.matterId,
    detail: JSON.stringify({
      action,
      status: record.status,
      admissionId: record.admissionId,
      hits: record.conflict.hits.length,
    }),
  }).catch(() => {
    /* ignore */
  });
}

function saveAdmission(workspaceDir: string, record: AdmissionRecord): AdmissionRecord {
  const parsed = AdmissionRecordSchema.parse(record);
  writeJsonAtomic(admissionPath(workspaceDir, parsed.matterId), parsed);
  return parsed;
}

function withTimeline(record: AdmissionRecord, entry: AdmissionTimelineEntry): AdmissionRecord {
  return {
    ...record,
    timeline: [...record.timeline, entry].slice(-200),
    updatedAt: entry.at,
  };
}

function missingDisclosures(record: AdmissionRecord): string[] {
  const missing: string[] = [];
  if (record.riskDisclosure.status !== "acknowledged") {
    missing.push("risk");
  }
  if (record.aiDisclosure.status !== "acknowledged") {
    missing.push("ai");
  }
  return missing;
}

/**
 * 从一条来件推导候选当事人：发件人是默认的委托人候选；正文里带「原告：」「被告：」
 * 这类标签的人作为关联方候选。只登记，不判断立场，立场由律师在收案时确认。
 */
export function admissionCandidatesFromItem(item: IntakeItem): AdmissionCandidate[] {
  const out: AdmissionCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: AdmissionCandidate) => {
    const key = candidate.name.trim().toLowerCase();
    if (!key || seen.has(key) || out.length >= 32) {
      return;
    }
    seen.add(key);
    out.push(candidate);
  };
  const senderName = item.from?.display?.trim();
  const senderAddress = item.from?.address?.trim();
  if (senderName || senderAddress) {
    push({
      name: (senderName || senderAddress || "").slice(0, 120),
      role: "client",
      source: "intake",
      itemId: item.id,
    });
  }
  for (const row of scanPartyCandidates(item.text).kept) {
    const label = row.label.trim();
    const role = /委托|我方|客户/.test(label)
      ? "client"
      : /对方|相对方/.test(label)
        ? "counterparty"
        : "related";
    push({
      name: row.name,
      role,
      source: "intake",
      itemId: item.id,
      ...(label ? { label } : {}),
    });
  }
  return out;
}

export function loadAdmission(workspaceDir: string, matterId: string): AdmissionRecord | undefined {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return undefined;
  }
  return readAdmissionFile(workspaceDir, id);
}

export function listAdmissions(
  workspaceDir: string,
  opts?: { statuses?: AdmissionStatus[]; limit?: number },
): AdmissionRecord[] {
  const dir = admissionRoot(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const statuses = opts?.statuses ? new Set(opts.statuses) : undefined;
  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 500));
  const out: AdmissionRecord[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const record = readAdmissionFile(workspaceDir, name.slice(0, -".json".length));
    if (!record || (statuses && !statuses.has(record.status))) {
      continue;
    }
    out.push(record);
  }
  return out.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

/**
 * 建收案记录。幂等：已有记录时原样返回，不重置已经做过的扫描/告知。
 * 只给 `intake` 案件建记录；已在办的老案件不追溯，避免把存量工作区锁死。
 */
export function createAdmission(
  workspaceDir: string,
  input: {
    matterId: string;
    matterTitle?: string;
    sourceItemIds?: string[];
    candidates?: AdmissionCandidate[];
    ownerLawyerId?: string;
    now?: Date;
  },
): AdmissionResult {
  const matterId = input.matterId.trim();
  if (!isValidMatterId(matterId)) {
    return { ok: false, error: "invalid_matter_id" };
  }
  return withAdmissionLock(workspaceDir, () => {
    const existing = readAdmissionFile(workspaceDir, matterId);
    if (existing) {
      return { ok: true, admission: existing };
    }
    const matter = loadMatter(workspaceDir, matterId);
    if (!matter) {
      return { ok: false, error: "matter_not_found" };
    }
    const at = nowIso(input.now);
    const owner = input.ownerLawyerId?.trim();
    const title = input.matterTitle?.trim() || matter.title;
    const record: AdmissionRecord = {
      schemaVersion: 1,
      admissionId: newAdmissionId(),
      matterId,
      ...(title ? { matterTitle: title.slice(0, 200) } : {}),
      sourceItemIds: [
        ...new Set((input.sourceItemIds ?? []).map((id) => id.trim()).filter(Boolean)),
      ].slice(0, 50),
      candidates: (input.candidates ?? [])
        .filter((row) => row.name.trim())
        .slice(0, 32)
        .map((row) => ({ ...row, name: row.name.trim().slice(0, 120) })),
      ...(owner ? { ownerLawyerId: owner } : {}),
      status: "prospective",
      conflict: { status: "pending", hits: [] },
      riskDisclosure: { status: "missing" },
      aiDisclosure: { status: "missing" },
      timeline: [{ at, kind: "created", by: "system" }],
      createdAt: at,
      updatedAt: at,
    };
    const saved = saveAdmission(workspaceDir, record);
    audit(workspaceDir, saved, "created", owner);
    return { ok: true, admission: saved };
  });
}

/** 记录负责人；接受委托前必须有负责人。 */
export function assignAdmissionOwner(
  workspaceDir: string,
  matterId: string,
  input: { ownerLawyerId: string; by?: string; now?: Date },
): AdmissionResult {
  const owner = input.ownerLawyerId.trim().slice(0, 120);
  if (!owner) {
    return { ok: false, error: "invalid_input" };
  }
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (DECIDED.has(record.status)) {
      return { ok: false, error: "already_decided" };
    }
    const at = nowIso(input.now);
    const next = withTimeline(
      { ...record, ownerLawyerId: owner },
      {
        at,
        kind: "owner_assigned",
        by: "lawyer",
        detail: owner,
      },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "owner_assigned", input.by ?? owner);
    return { ok: true, admission: saved };
  });
}

/** 律师补登候选当事人（来件没有发件人、或材料里没有标签时使用）。 */
export function addAdmissionCandidates(
  workspaceDir: string,
  matterId: string,
  input: { candidates: AdmissionCandidate[]; by: string; now?: Date },
): AdmissionResult {
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (DECIDED.has(record.status)) {
      return { ok: false, error: "already_decided" };
    }
    const by = input.by.trim().slice(0, 120);
    if (!by) {
      return { ok: false, error: "invalid_input" };
    }
    const seen = new Set(record.candidates.map((row) => row.name.trim().toLowerCase()));
    const added: AdmissionCandidate[] = [];
    for (const row of input.candidates) {
      const name = row.name.trim().slice(0, 120);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) {
        continue;
      }
      seen.add(key);
      added.push({
        ...row,
        name,
        source: "lawyer",
        ...(row.label?.trim() ? { label: row.label.trim().slice(0, 40) } : {}),
      });
      if (record.candidates.length + added.length >= 32) {
        break;
      }
    }
    if (added.length === 0) {
      return { ok: true, admission: record };
    }
    const at = nowIso(input.now);
    const next = withTimeline(
      { ...record, candidates: [...record.candidates, ...added] },
      {
        at,
        kind: "candidates_added",
        by: "lawyer",
        detail: added
          .map((row) => row.name)
          .join("、")
          .slice(0, 500),
      },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "candidates_added", by);
    return { ok: true, admission: saved };
  });
}

/** 开始（或重做）冲突扫描；旧的命中结果会被清掉，避免用一轮旧结论放行。 */
export function beginConflictScan(
  workspaceDir: string,
  matterId: string,
  input?: { by?: string; note?: string; now?: Date },
): AdmissionResult {
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (DECIDED.has(record.status)) {
      return { ok: false, error: "already_decided" };
    }
    const at = nowIso(input?.now);
    const next = withTimeline(
      {
        ...record,
        status: "conflict_pending",
        conflict: {
          status: "pending",
          hits: [],
          ...(input?.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
        },
      },
      { at, kind: "scan_started", by: "lawyer" },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "scan_started", input?.by);
    return { ok: true, admission: saved };
  });
}

/**
 * 记录一次冲突扫描结论。`hits` 为空即 clear；有命中仍可进入律师审核，
 * 但接受委托时必须给出书面 override 理由。
 */
export function recordConflictScan(
  workspaceDir: string,
  matterId: string,
  input: {
    hits: AdmissionConflictHit[];
    by?: string;
    note?: string;
    now?: Date;
  },
): AdmissionResult {
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (DECIDED.has(record.status)) {
      return { ok: false, error: "already_decided" };
    }
    const seen = new Set<string>();
    const hits: AdmissionConflictHit[] = [];
    for (const hit of input.hits) {
      const partyName = hit.partyName.trim().slice(0, 120);
      const matterIdHit = hit.matterId.trim().slice(0, 128);
      const reason = hit.reason.trim().slice(0, 500);
      if (!partyName || !matterIdHit) {
        continue;
      }
      const key = `${matterIdHit}\u0000${partyName}\u0000${reason}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push({
        ...hit,
        matterId: matterIdHit,
        partyName,
        reason,
        ...(hit.matterTitle?.trim() ? { matterTitle: hit.matterTitle.trim().slice(0, 200) } : {}),
      });
      if (hits.length >= 50) {
        break;
      }
    }
    const at = nowIso(input.now);
    const next = withTimeline(
      {
        ...record,
        status: "lawyer_review",
        conflict: {
          status: hits.length > 0 ? "hit" : "clear",
          scannedAt: at,
          ...(input.by?.trim() ? { scannedBy: input.by.trim().slice(0, 120) } : {}),
          hits,
          ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
        },
      },
      {
        at,
        kind: "scan_recorded",
        by: "lawyer",
        detail: hits.length > 0 ? `hit:${hits.length}` : "clear",
      },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "scan_recorded", input.by);
    return { ok: true, admission: saved };
  });
}

/** 律师确认风险告知 / AI 使用告知已完成。两项都确认后决定才能提交。 */
export function acknowledgeAdmissionDisclosures(
  workspaceDir: string,
  matterId: string,
  input: { risk?: boolean; ai?: boolean; by: string; now?: Date },
): AdmissionResult {
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (DECIDED.has(record.status)) {
      return { ok: false, error: "already_decided" };
    }
    const by = input.by.trim().slice(0, 120);
    if (!by) {
      return { ok: false, error: "invalid_input" };
    }
    const riskChanged = input.risk === true && record.riskDisclosure.status !== "acknowledged";
    const aiChanged = input.ai === true && record.aiDisclosure.status !== "acknowledged";
    if (!riskChanged && !aiChanged) {
      return { ok: true, admission: record };
    }
    const at = nowIso(input.now);
    const next = withTimeline(
      {
        ...record,
        status: record.conflict.status === "pending" ? record.status : "lawyer_review",
        riskDisclosure: riskChanged ? { status: "acknowledged", at, by } : record.riskDisclosure,
        aiDisclosure: aiChanged ? { status: "acknowledged", at, by } : record.aiDisclosure,
      },
      {
        at,
        kind: "disclosure_acknowledged",
        by: "lawyer",
        detail: [riskChanged ? "risk" : "", aiChanged ? "ai" : ""].filter(Boolean).join(","),
      },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "disclosure_acknowledged", by);
    return { ok: true, admission: saved };
  });
}

/**
 * 律师决定接受或婉拒。
 *
 * accept 的前置条件（缺一不可）：
 * - 冲突扫描已完成（clear 或 hit）；
 * - 已有负责人；
 * - 风险告知与 AI 使用告知都确认；
 * - 有命中时必须给出 override 理由。
 *
 * accept 同时把 `MatterRecord.status` 从 `intake` 改成 `active`；decline 不改案件状态。
 */
export function decideAdmission(
  workspaceDir: string,
  matterId: string,
  input: {
    decision: "accept" | "decline";
    by: string;
    note?: string;
    overrideReason?: string;
    now?: Date;
  },
): AdmissionResult {
  const by = input.by.trim().slice(0, 120);
  if (!by) {
    return { ok: false, error: "invalid_input" };
  }
  return withAdmissionLock(workspaceDir, () => {
    const record = readAdmissionFile(workspaceDir, matterId);
    if (!record) {
      return { ok: false, error: "not_found" };
    }
    if (record.decision) {
      return record.decision.kind === input.decision
        ? { ok: true, admission: record }
        : { ok: false, error: "already_decided" };
    }
    const at = nowIso(input.now);
    const note = input.note?.trim().slice(0, 500);

    if (input.decision === "decline") {
      const next = withTimeline(
        {
          ...record,
          status: "declined",
          decision: { kind: "decline", by, at, ...(note ? { note } : {}) },
        },
        { at, kind: "declined", by: "lawyer", ...(note ? { detail: note } : {}) },
      );
      const saved = saveAdmission(workspaceDir, next);
      audit(workspaceDir, saved, "declined", by);
      return { ok: true, admission: saved };
    }

    if (record.conflict.status === "pending") {
      return { ok: false, error: "conflict_pending" };
    }
    const overrideReason =
      input.overrideReason?.trim().slice(0, 500) || record.conflict.overrideReason;
    if (record.conflict.status === "hit" && !overrideReason) {
      return { ok: false, error: "conflict_override_required" };
    }
    if (missingDisclosures(record).length > 0) {
      return { ok: false, error: "disclosures_missing" };
    }
    if (!record.ownerLawyerId?.trim()) {
      return { ok: false, error: "owner_missing" };
    }
    const matter = loadMatter(workspaceDir, matterId);
    if (!matter) {
      return { ok: false, error: "matter_not_found" };
    }
    if (matter.status !== "intake" && matter.status !== "active") {
      return { ok: false, error: "matter_not_intake" };
    }
    // 先改案件状态，再落收案记录：如果第二步失败，记录仍是 lawyer_review，
    // 外发闸门继续拦截；反过来会出现「案件 active、记录 pending」的假放行。
    updateMatterStatus(workspaceDir, matterId, "active");
    // 接案完成后关闭旧的「完成利益冲突检查」待办；扫描记录已经在收案记录里。
    for (const item of listQueueItemsForMatter(workspaceDir, matterId, {
      kind: "need_conflict_check",
      status: "open",
    })) {
      transitionQueueItem(workspaceDir, matterId, item.queueItemId, "resolved");
    }
    const next = withTimeline(
      {
        ...record,
        status: "accepted",
        conflict:
          record.conflict.status === "hit" && overrideReason
            ? {
                ...record.conflict,
                overrideReason,
                overrideBy: by,
                overrideAt: at,
              }
            : record.conflict,
        decision: { kind: "accept", by, at, ...(note ? { note } : {}) },
      },
      { at, kind: "accepted", by: "lawyer", ...(note ? { detail: note } : {}) },
    );
    const saved = saveAdmission(workspaceDir, next);
    audit(workspaceDir, saved, "accepted", by);
    return { ok: true, admission: saved };
  });
}

/**
 * 外发闸门。调用方是邮件工具和「签批发送」路由，不是模型提示词。
 *
 * 祖父条款：
 * - 只有 `cases/<id>` 没有 `matters/<id>/matter.json` 的历史工作区按存量放行；
 * - admission 上线前已经在办（非 intake）的案件没有收案记录，也不追溯阻断；
 * - 有 `matter.json` 且仍是 `intake` 的案件，缺收案记录就拒绝。
 */
export function checkAdmissionGate(workspaceDir: string, matterId: string): AdmissionGate {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { allowed: false, reason: "matter_missing" };
  }
  const admission = loadAdmission(workspaceDir, id);
  if (!admission) {
    const matter = loadMatter(workspaceDir, id);
    if (!matter) {
      // 历史工作区只有 cases/<id>/CASE.md，没有 matters/<id>/matter.json；
      // 在这里拒绝会把存量案件的全部外发路径锁死，而且与收案记录无关。
      return { allowed: true };
    }
    return matter.status === "intake"
      ? { allowed: false, reason: "admission_missing" }
      : { allowed: true };
  }
  if (admission.status === "accepted") {
    if (!loadMatter(workspaceDir, id)) {
      return { allowed: false, reason: "matter_missing", admission };
    }
    return { allowed: true, admission };
  }
  return { allowed: false, reason: admission.status, admission };
}

export function admissionGateMessage(reason: AdmissionGateReason | undefined): string {
  switch (reason) {
    case "matter_missing":
      return "案件不存在，不能外发。";
    case "admission_missing":
      return "本案还没有收案记录：请先完成利益冲突扫描、风险告知和 AI 使用告知，再由律师接受委托。";
    case "prospective":
      return "收案记录尚未开始冲突扫描，暂不能外发。";
    case "conflict_pending":
      return "利益冲突扫描尚未完成，暂不能外发。";
    case "lawyer_review":
      return "收案记录还在律师审核中，尚未接受委托，暂不能外发。";
    case "declined":
      return "本案已婉拒，不能外发。";
    default:
      return "收案状态不允许外发。";
  }
}
