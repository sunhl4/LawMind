import {
  mattersConflict,
  partiesConflict,
  readMatterParties,
  type MatterParties,
} from "../../host-access/matter-fence.js";
import {
  isSingleSlotKey,
  keySearchText,
  type MemoryKernelScope,
  type MemoryRecord,
} from "./contract.js";
import { ensureMemoryImported } from "./migrate.js";
import { listMemoryRecords, searchMemoryIds } from "./store.js";

const PROMPT_CHAR_BUDGET = 2_400;
const MIN_STANCE_CONFIDENCE = 0.4;
const MIN_STANCE_MATTERS = 2;

function decayedConfidence(confidence: number, updatedAt: string, nowMs: number): number {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) {
    return confidence;
  }
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  if (ageDays < 30) {
    return confidence;
  }
  const decay = Math.max(0.5, 1 - ageDays / 365);
  return confidence * decay;
}

function terms(query: string): string[] {
  const cleaned = query
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = new Set<string>();
  for (const part of cleaned.split(" ")) {
    if (part.length >= 2 && part.length <= 12) {
      out.add(part.toLowerCase());
    }
  }
  const cjk = cleaned.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1 && out.size < 48; i += 1) {
    out.add(cjk.slice(i, i + 2));
  }
  return [...out];
}

function overlap(text: string, needles: readonly string[]): number {
  if (needles.length === 0) {
    return 0;
  }
  const hay = text.toLowerCase();
  let score = 0;
  for (const needle of needles) {
    if (hay.includes(needle)) {
      score += needle.length >= 3 ? 2 : 1;
    }
  }
  return score;
}

function recordConflicts(record: MemoryRecord, current: MatterParties): boolean {
  if (!record.clientId && !record.counterparty) {
    return false;
  }
  return partiesConflict({ clientId: record.clientId, counterparty: record.counterparty }, current);
}

function stanceVisible(record: MemoryRecord, matterId: string | undefined, nowMs: number): boolean {
  if (record.kind !== "stance") {
    return true;
  }
  if (record.origin === "firm_default") {
    return false;
  }
  const confidence = record.confidence ?? 0.5;
  if (decayedConfidence(confidence, record.updatedAt, nowMs) < MIN_STANCE_CONFIDENCE) {
    return false;
  }
  const matters = new Set(record.evidenceMatterIds.filter(Boolean));
  if (matterId && matters.has(matterId)) {
    return true;
  }
  if (matters.size < MIN_STANCE_MATTERS) {
    return false;
  }
  return true;
}

export type MemoryTurnQuery = {
  matterId?: string;
  clientId?: string;
  query: string;
  /** 律师点名要对照的旧案。缺省不注入任何其他案件。 */
  precedentMatterIds?: string[];
  nowMs?: number;
};

export function selectMemoryForTurn(workspaceDir: string, opts: MemoryTurnQuery): MemoryRecord[] {
  ensureMemoryImported(workspaceDir);
  const nowMs = opts.nowMs ?? Date.now();
  const matterId = opts.matterId?.trim() || undefined;
  const parties = matterId ? readMatterParties(workspaceDir, matterId) : {};
  const clientId = opts.clientId?.trim() || parties.clientId;
  const precedents = new Set(
    (opts.precedentMatterIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const needles = terms(opts.query);
  const ftsIds = searchMemoryIds(workspaceDir, opts.query);
  const rows = listMemoryRecords(workspaceDir).filter((row) => {
    if (row.confirmation !== "confirmed" || row.validity !== "current") {
      return false;
    }
    if (recordConflicts(row, parties)) {
      return false;
    }
    if (!stanceVisible(row, matterId, nowMs)) {
      return false;
    }
    if (row.scope === "matter") {
      if (matterId && row.scopeId === matterId) {
        return true;
      }
      if (!row.scopeId || !precedents.has(row.scopeId)) {
        return false;
      }
      return !mattersConflict(workspaceDir, matterId ?? "", row.scopeId);
    }
    if (row.scope === "client") {
      return Boolean(clientId && row.scopeId === clientId);
    }
    return row.scope === "lawyer" || row.scope === "firm";
  });
  const ranked = rows
    .map((row) => {
      const pinned = row.key === "habit.identity" || row.key === "matter.parties";
      const slot = isSingleSlotKey(row.key);
      const label = keySearchText(row.key);
      const lexical = overlap(`${row.key}\n${label}\n${row.body}`, needles);
      const score = pinned ? 1_000 : slot ? 500 + lexical : lexical + (ftsIds.has(row.id) ? 3 : 0);
      return { row, score, pinned, slot };
    })
    .filter((item) => {
      // 写法槽和当事人始终保留。散句可以按问句挑，但不能把槽位挤出预算：槽位分更高，先入选。
      if (item.pinned || item.slot || item.row.scope !== "matter") {
        return true;
      }
      return item.score > 0 || needles.length === 0;
    })
    .toSorted((a, b) => b.score - a.score || b.row.updatedAt.localeCompare(a.row.updatedAt));
  const picked: MemoryRecord[] = [];
  let used = 0;
  for (const item of ranked) {
    const line = item.row.body.length + item.row.key.length + 8;
    if (picked.length > 0 && used + line > PROMPT_CHAR_BUDGET) {
      continue;
    }
    picked.push(item.row);
    used += line;
  }
  return picked;
}

export function formatKernelMemoryForPrompt(workspaceDir: string, opts: MemoryTurnQuery): string {
  const rows = selectMemoryForTurn(workspaceDir, opts);
  if (rows.length === 0) {
    return "";
  }
  const lines = rows.map((row) => `- [${row.key}] ${row.body}`);
  return [
    "已确认且当前有效的记忆（未确认与已作废的不在这里；其他案件不自动混入）：",
    ...lines,
  ].join("\n");
}

/** 显式对照：只在调用方点名旧案时返回那些案件的有效事实。 */
export function formatExplicitPrecedentRecall(
  workspaceDir: string,
  opts: { matterId?: string; precedentMatterIds: string[]; query?: string },
): string {
  const rows = selectMemoryForTurn(workspaceDir, {
    matterId: opts.matterId,
    query: opts.query ?? "",
    precedentMatterIds: opts.precedentMatterIds,
  }).filter((row) => row.scope === "matter" && opts.precedentMatterIds.includes(row.scopeId));
  if (rows.length === 0) {
    return "";
  }
  return ["对照律师点名的旧案（事实仍以本案为准）：", ...rows.map((row) => `- ${row.body}`)].join(
    "\n",
  );
}

/** 已撤回或已取代的正文。用来挡住档案和案件窗口把旧句再送进提示词。 */
export function terminalMemoryBodies(
  workspaceDir: string,
  opts?: { scope?: MemoryKernelScope; scopeId?: string },
): string[] {
  ensureMemoryImported(workspaceDir);
  const scope = opts?.scope;
  const scopeId = opts?.scopeId?.trim() ?? "";
  const bodies = listMemoryRecords(workspaceDir)
    .filter((row) => row.validity === "revoked" || row.validity === "superseded")
    .filter((row) => {
      if (!scope) {
        return true;
      }
      return (
        row.scope === scope && (scope === "lawyer" || scope === "firm" || row.scopeId === scopeId)
      );
    })
    .map((row) => row.body.trim())
    .filter((body) => body.length >= 6);
  return [...new Set(bodies)].toSorted((a, b) => b.length - a.length);
}

/** 去掉含有这些正文的非标题行。标题保留。 */
export function omitLinesCarryingBodies(text: string, bodies: readonly string[]): string {
  if (!text || bodies.length === 0) {
    return text;
  }
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return true;
      }
      return !bodies.some((body) => trimmed.includes(body));
    })
    .join("\n");
}
