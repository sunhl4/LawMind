/**
 * 记忆内核契约。
 *
 * 真相源是工作区里的 SQLite（`lawmind/memory-kernel.sqlite`）。
 * Markdown / 立场 JSON 是给人看的投影，以及旧数据的导入来源。
 * 进提示词的只有：已确认、当前有效、范围匹配、且与本案当事人不冲突的记录。
 *
 * 键是槽位名，不是质量黑名单。表里没有的键可以写。
 * 单槽键（语气、结构、某一类条款立场）新确认会取代旧的；其余键可以并存。
 */

export const MEMORY_KERNEL_SCHEMA_VERSION = 1 as const;

/** Harvey 个人记忆里反复出现、且本产品已有落点的写法槽。 */
export const CANONICAL_HABIT_KEYS = [
  { key: "habit.voice", label: "语气" },
  { key: "habit.structure", label: "结构" },
  { key: "habit.citation", label: "引用体例" },
  { key: "habit.redline", label: "改稿方式" },
  { key: "habit.risk", label: "风险口径" },
  { key: "habit.format", label: "格式" },
] as const;

export const MEMORY_KINDS = [
  "habit",
  "stance",
  "client_note",
  "matter_fact",
  "playbook_note",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KERNEL_SCOPES = ["lawyer", "client", "matter", "firm"] as const;

export type MemoryKernelScope = (typeof MEMORY_KERNEL_SCOPES)[number];

export const MEMORY_CONFIRMATIONS = ["pending", "confirmed", "dismissed"] as const;

export type MemoryConfirmation = (typeof MEMORY_CONFIRMATIONS)[number];

export const MEMORY_VALIDITIES = ["current", "superseded", "revoked"] as const;

export type MemoryValidity = (typeof MEMORY_VALIDITIES)[number];

export type MemoryOrigin =
  | "lawyer"
  | "review"
  | "engine"
  | "migration"
  | "stance"
  | "firm_default"
  | "consolidation";

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  scope: MemoryKernelScope;
  scopeId: string;
  key: string;
  body: string;
  confirmation: MemoryConfirmation;
  validity: MemoryValidity;
  supersededBy?: string;
  sourceMatterId?: string;
  clientId?: string;
  counterparty?: string;
  sourceTaskId?: string;
  origin: MemoryOrigin;
  confidence?: number;
  evidenceMatterIds: string[];
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type MemoryLibraryView = "habits" | "matter" | "revoked";

const KEY_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,78}$/u;

export function isMemoryKey(key: string): boolean {
  return KEY_RE.test(key.trim());
}

/** 同一范围下只保留一条「当前有效」的键。 */
export function isSingleSlotKey(key: string): boolean {
  if (key.startsWith("stance.")) {
    return true;
  }
  return CANONICAL_HABIT_KEYS.some((row) => row.key === key) || key === "habit.identity";
}

const KEY_LABELS: Record<string, string> = {
  "habit.voice": "语气",
  "habit.structure": "结构",
  "habit.citation": "引用体例",
  "habit.redline": "改稿方式",
  "habit.risk": "风险口径",
  "habit.format": "格式",
  "habit.identity": "身份",
  "matter.parties": "当事人",
  "matter.core_issue": "争点",
  "matter.risk": "风险",
  "matter.progress": "进展",
  "matter.goal": "目标",
  "matter.artifact": "产物",
};

const EXTRA_KEY_LABELS: Record<string, string> = {
  "habit.note": "习惯",
  "habit.review": "审核记录",
  "matter.note": "笔记",
  "client.note": "客户备注",
  "playbook.clause": "条款",
};

/** 界面上的槽位名。没有中文名时不露出内部键。 */
export function memoryKeyLabel(key: string): string {
  return KEY_LABELS[key] || EXTRA_KEY_LABELS[key] || keySearchText(key) || "记录";
}

/** 槽位的中文名，给召回用。没有中文名的键不编造同义词。 */
export function keySearchText(key: string): string {
  if (KEY_LABELS[key]) {
    return KEY_LABELS[key];
  }
  if (key.startsWith("stance.")) {
    return key.slice("stance.".length);
  }
  return "";
}

export function defaultConfirmation(
  kind: MemoryKind,
  confirmNow: boolean | undefined,
): MemoryConfirmation {
  if (confirmNow === true) {
    return "confirmed";
  }
  if (confirmNow === false) {
    return "pending";
  }
  // 本案事实是在记发生过的事，不在主路径上多一次确认。
  return kind === "matter_fact" ? "confirmed" : "pending";
}
