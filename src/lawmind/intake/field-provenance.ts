/**
 * 案件字段出处（P1.4）。
 *
 * 目标：自动填入的案件字段必须能回指收件条目和原文片段，不能只有值没有来源。
 * - 记录落在 `lawmind/intake/provenance/<matterId>.json`（agent 工作区黑名单内）；
 * - 卷宗已有不同值时**不覆盖**，写一条 `need_client_input` 待办请律师核对；
 * - 没有出处的已有字段由 `listMissingProvenance` 报出来，供收案卡/体检使用。
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadMatter, type MatterRecord } from "../adapters/matter-storage/index.js";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { updateMatterProfile } from "../application/services/matter-write-service.js";
import {
  listQueueItemsForMatter,
  openQueueItem,
} from "../application/services/queue-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { scanPartyCandidates } from "../desk/intake-promote.js";
import type { MatterDocket } from "../desk/matter-kind.js";
import { getIntakeItem, intakeRoot } from "./store.js";
import type { IntakeItem } from "./types.js";

export const MATTER_PROVENANCE_FIELDS = [
  "clientId",
  "counterparty",
  "causeOfAction",
  "matterLabel",
  "docket.caseNo",
  "docket.court",
  "docket.instance",
  "docket.standing",
] as const;
export type MatterProvenanceField = (typeof MATTER_PROVENANCE_FIELDS)[number];

export const MatterProvenanceFieldSchema = z.enum(MATTER_PROVENANCE_FIELDS);

export const FIELD_LABELS: Record<MatterProvenanceField, string> = {
  clientId: "客户",
  counterparty: "对方当事人",
  causeOfAction: "案由",
  matterLabel: "事项名称",
  "docket.caseNo": "案号",
  "docket.court": "法院",
  "docket.instance": "审级",
  "docket.standing": "诉讼地位",
};

export const FieldProvenanceInputSchema = z.object({
  field: MatterProvenanceFieldSchema,
  value: z.string().trim().min(1).max(240),
  quote: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1),
});

export const FieldProvenanceEntrySchema = z.object({
  field: MatterProvenanceFieldSchema,
  value: z.string().trim().min(1).max(240),
  itemId: z.string().trim().min(1).max(64),
  quote: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1),
  capturedAt: z.string(),
  source: z.enum(["intake", "lawyer"]),
  status: z.enum(["applied", "same", "conflict"]),
});
export type FieldProvenanceEntry = z.infer<typeof FieldProvenanceEntrySchema>;

const FieldProvenanceFileSchema = z.object({
  schemaVersion: z.literal(1),
  matterId: z.string().trim().min(1).max(128),
  entries: z.array(FieldProvenanceEntrySchema).max(500),
});
export type FieldProvenanceFile = z.infer<typeof FieldProvenanceFileSchema>;

export type ProvenanceCoverage = {
  /** 已有非空值、但没有 applied/same 出处的字段。 */
  missing: Array<{ field: MatterProvenanceField; value: string }>;
  /** 当前有值的字段总数。 */
  tracked: number;
};

export type ProvenanceApplyResult =
  | {
      ok: true;
      applied: MatterProvenanceField[];
      same: MatterProvenanceField[];
      conflicts: MatterProvenanceField[];
      coverage: ProvenanceCoverage;
    }
  | {
      ok: false;
      error: "invalid_matter_id" | "matter_not_found" | "item_not_found" | "invalid_input";
    };

export function provenanceRoot(workspaceDir: string): string {
  return path.join(intakeRoot(workspaceDir), "provenance");
}

export function provenancePath(workspaceDir: string, matterId: string): string {
  return path.join(provenanceRoot(workspaceDir), `${matterId}.json`);
}

function provenanceLockPath(workspaceDir: string): string {
  return path.join(provenanceRoot(workspaceDir), ".lock");
}

function withProvenanceLock<T>(workspaceDir: string, fn: () => T): T {
  return withExclusiveFileLock(provenanceLockPath(workspaceDir), fn);
}

function readFile(workspaceDir: string, matterId: string): FieldProvenanceFile {
  try {
    const file = provenancePath(workspaceDir, matterId);
    if (!fs.existsSync(file)) {
      return { schemaVersion: 1, matterId, entries: [] };
    }
    const parsed = FieldProvenanceFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : { schemaVersion: 1, matterId, entries: [] };
  } catch {
    return { schemaVersion: 1, matterId, entries: [] };
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function existingValue(matter: MatterRecord, field: MatterProvenanceField): string | undefined {
  switch (field) {
    case "clientId":
      return matter.clientId;
    case "counterparty":
      return matter.counterparty;
    case "causeOfAction":
      return matter.causeOfAction;
    case "matterLabel":
      return matter.matterLabel;
    case "docket.caseNo":
      return matter.docket?.caseNo;
    case "docket.court":
      return matter.docket?.court;
    case "docket.instance":
      return matter.docket?.instance;
    case "docket.standing":
      return matter.docket?.standing;
    default:
      return undefined;
  }
}

function isDocketField(field: MatterProvenanceField): boolean {
  return field.startsWith("docket.");
}

function latestByField(
  entries: FieldProvenanceEntry[],
): Map<MatterProvenanceField, FieldProvenanceEntry> {
  const map = new Map<MatterProvenanceField, FieldProvenanceEntry>();
  for (const entry of entries) {
    if (entry.status === "applied" || entry.status === "same") {
      map.set(entry.field, entry);
    }
  }
  return map;
}

export function loadFieldProvenance(
  workspaceDir: string,
  matterId: string,
): FieldProvenanceFile | undefined {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return undefined;
  }
  const file = provenancePath(workspaceDir, id);
  return fs.existsSync(file) ? readFile(workspaceDir, id) : undefined;
}

/** 报出「有值但没有出处」的字段；不会把律师手填字段误判成自动字段。 */
export function listMissingProvenance(workspaceDir: string, matterId: string): ProvenanceCoverage {
  const matter = loadMatter(workspaceDir, matterId);
  if (!matter) {
    return { missing: [], tracked: 0 };
  }
  const current = latestByField(readFile(workspaceDir, matterId).entries);
  const missing: ProvenanceCoverage["missing"] = [];
  let tracked = 0;
  for (const field of MATTER_PROVENANCE_FIELDS) {
    const value = existingValue(matter, field)?.trim();
    if (!value) {
      continue;
    }
    tracked += 1;
    if (!current.has(field)) {
      missing.push({ field, value });
    }
  }
  return { missing, tracked };
}

function ensureConflictQueueItem(input: {
  workspaceDir: string;
  matterId: string;
  field: MatterProvenanceField;
  intakeValue: string;
  existing: string;
  itemId: string;
  quote: string;
}): void {
  const title = `核对${FIELD_LABELS[input.field]}`;
  const open = listQueueItemsForMatter(input.workspaceDir, input.matterId, {
    kind: "need_client_input",
    status: "open",
  });
  if (open.some((item) => item.title === title)) {
    return;
  }
  openQueueItem(input.workspaceDir, {
    matterId: input.matterId,
    kind: "need_client_input",
    title,
    priority: "normal",
    detail: `来件写「${input.intakeValue}」，卷宗已填「${input.existing}」，未覆盖。来源：${input.itemId}；原文：${input.quote}`,
  });
}

/**
 * 把来件字段写进卷宗并记出处。
 *
 * - 空字段：写入并记 `applied`；
 * - 同值：不写，记 `same`；
 * - 不同值：不覆盖，记 `conflict`，并开一条 `need_client_input`。
 */
export async function applyIntakeFieldProvenance(
  workspaceDir: string,
  matterId: string,
  input: {
    itemId: string;
    fields: Array<{
      field: MatterProvenanceField;
      value: string;
      quote: string;
      confidence: number;
    }>;
    source?: "intake" | "lawyer";
    now?: Date;
  },
): Promise<ProvenanceApplyResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "invalid_matter_id" };
  }
  const matter = loadMatter(workspaceDir, id);
  if (!matter) {
    return { ok: false, error: "matter_not_found" };
  }
  const itemId = input.itemId.trim();
  if (!itemId) {
    return { ok: false, error: "invalid_input" };
  }
  const capturedAt = (input.now ?? new Date()).toISOString();
  const seen = new Set<MatterProvenanceField>();
  const entries: FieldProvenanceEntry[] = [];
  const applied: MatterProvenanceField[] = [];
  const same: MatterProvenanceField[] = [];
  const conflicts: MatterProvenanceField[] = [];

  const update: {
    matterId: string;
    clientId?: string;
    counterparty?: string;
    causeOfAction?: string;
    matterLabel?: string;
    docket?: MatterDocket;
  } = { matterId: id };
  const docket: MatterDocket = { ...matter.docket };
  let docketChanged = false;

  for (const row of input.fields) {
    const field = row.field;
    const value = row.value.trim().slice(0, 240);
    const quote = row.quote.trim().slice(0, 240);
    if (!value || !quote || seen.has(field)) {
      continue;
    }
    seen.add(field);
    const current = existingValue(matter, field)?.trim() ?? "";
    const base = {
      field,
      value,
      itemId,
      quote,
      confidence: Math.max(0, Math.min(1, row.confidence)),
      capturedAt,
      source: input.source ?? "intake",
    } satisfies Omit<FieldProvenanceEntry, "status">;

    if (!current) {
      entries.push({ ...base, status: "applied" });
      applied.push(field);
      if (isDocketField(field)) {
        switch (field) {
          case "docket.caseNo":
            docket.caseNo = value;
            break;
          case "docket.court":
            docket.court = value;
            break;
          case "docket.instance":
            docket.instance = value;
            break;
          case "docket.standing":
            docket.standing = value;
            break;
        }
        docketChanged = true;
      } else {
        switch (field) {
          case "clientId":
            update.clientId = value;
            break;
          case "counterparty":
            update.counterparty = value;
            break;
          case "causeOfAction":
            update.causeOfAction = value;
            break;
          case "matterLabel":
            update.matterLabel = value;
            break;
        }
      }
      continue;
    }
    if (normalize(current) === normalize(value)) {
      entries.push({ ...base, status: "same" });
      same.push(field);
      continue;
    }
    entries.push({ ...base, status: "conflict" });
    conflicts.push(field);
    ensureConflictQueueItem({
      workspaceDir,
      matterId: id,
      field,
      intakeValue: value,
      existing: current,
      itemId,
      quote,
    });
  }

  if (docketChanged) {
    update.docket = docket;
  }
  if (applied.length > 0) {
    const saved = await updateMatterProfile(workspaceDir, update);
    if (!saved) {
      return { ok: false, error: "matter_not_found" };
    }
  }
  if (entries.length > 0) {
    withProvenanceLock(workspaceDir, () => {
      const file = readFile(workspaceDir, id);
      writeJsonAtomic(provenancePath(workspaceDir, id), {
        schemaVersion: 1,
        matterId: id,
        entries: [...file.entries, ...entries].slice(-500),
      } satisfies FieldProvenanceFile);
    });
  }
  return {
    ok: true,
    applied,
    same,
    conflicts,
    coverage: listMissingProvenance(workspaceDir, id),
  };
}

const CASE_NO_RE =
  /[（(]\s*\d{4}\s*[）)]\s*[\u4e00-\u9fa5]{1,10}\d{0,10}[\u4e00-\u9fa5]{1,10}\d{1,10}\s*号/;

function haystack(item: IntakeItem): string {
  return `${item.subject ?? ""}\n${item.text}`;
}

function quoteFor(text: string, needle: string): string {
  const line = text
    .split(/\n/)
    .map((row) => row.trim())
    .find((row) => row.includes(needle));
  return (line || needle).slice(0, 240);
}

/**
 * 确定性的字段抽取：只抽能被人一眼核对的东西。
 * confidence 是抽取规则的把握程度，不是模型概率。
 */
export function extractIntakeMatterFields(item: IntakeItem): Array<{
  field: MatterProvenanceField;
  value: string;
  quote: string;
  confidence: number;
}> {
  const text = haystack(item);
  const out: Array<{
    field: MatterProvenanceField;
    value: string;
    quote: string;
    confidence: number;
  }> = [];
  const seen = new Set<MatterProvenanceField>();
  const push = (row: (typeof out)[number]) => {
    if (!seen.has(row.field)) {
      seen.add(row.field);
      out.push(row);
    }
  };

  const caseNo = text.match(CASE_NO_RE)?.[0]?.trim();
  if (caseNo) {
    push({
      field: "docket.caseNo",
      value: caseNo,
      quote: quoteFor(text, caseNo),
      confidence: 0.9,
    });
  }

  const counterparty = scanPartyCandidates(item.text).kept.find((row) =>
    /被告|被申请人|被上诉人|对方|相对方/.test(row.label),
  );
  if (counterparty) {
    push({
      field: "counterparty",
      value: counterparty.name,
      quote: quoteFor(item.text, counterparty.name),
      confidence: 0.5,
    });
  }

  return out;
}

/** 从一条来件抽取并写入字段出处；给收案路由在 lead.accept 之后调用。 */
export async function applyIntakeFieldsFromItem(
  workspaceDir: string,
  matterId: string,
  itemId: string,
): Promise<ProvenanceApplyResult> {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, error: "item_not_found" };
  }
  const fields = extractIntakeMatterFields(item);
  if (fields.length === 0) {
    return {
      ok: true,
      applied: [],
      same: [],
      conflicts: [],
      coverage: listMissingProvenance(workspaceDir, matterId),
    };
  }
  return applyIntakeFieldProvenance(workspaceDir, matterId, { itemId, fields });
}
