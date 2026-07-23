/**
 * Plan → Execute handoff: extract plan text, persist per session, build confirm prompt.
 */

export type PlanHandoffMessage = {
  role: string;
  text?: string;
  content?: string;
};

export type StoredPlanHandoff = {
  planText: string;
  updatedAt: string;
};

const STORAGE_KEY = "lawmind.planHandoff.v1";
const PLAN_HINT =
  /(?:执行计划|工作计划|实施步骤|验收要点|所需材料|步骤[：:]|计划[：:]|【先计划】|先计划)/;

function messageText(m: PlanHandoffMessage): string {
  return (m.text ?? m.content ?? "").trim();
}

/** Prefer the latest assistant message that looks like a plan; else latest non-empty assistant. */
export function extractPlanHandoffText(messages: PlanHandoffMessage[]): string | null {
  const assistants = messages.filter((m) => m.role === "assistant" && messageText(m));
  if (assistants.length === 0) {
    return null;
  }
  for (let i = assistants.length - 1; i >= 0; i--) {
    const t = messageText(assistants[i]);
    if (PLAN_HINT.test(t) || /^\s*(?:[-*]|\d+[.)、])\s+\S/m.test(t)) {
      return t.slice(0, 2400);
    }
  }
  return messageText(assistants[assistants.length - 1]).slice(0, 2400);
}

export function buildExecuteConfirmPrompt(planText: string): string {
  const body = planText.trim();
  if (!body) {
    return "【确认执行】请按刚才约定的计划开始执行（可起草与写盘）。信息不足时先结构化追问。";
  }
  return `【确认执行】\n按下列计划开始执行（已切换到「标准」权限，可起草与写盘）：\n\n${body}\n\n请开始执行；缺关键事实时再用结构化问题追问。`;
}

/** True when composer should prefer injecting handoff (empty or only whitespace). */
export function shouldInjectExecuteHandoff(currentInput: string): boolean {
  return !currentInput.trim();
}

export function isExecuteConfirmPrompt(text: string): boolean {
  return text.trimStart().startsWith("【确认执行】");
}

export function planHandoffSummary(planText: string, maxLen = 72): string {
  const one = planText.replace(/\s+/g, " ").trim();
  if (one.length <= maxLen) {
    return one;
  }
  return `${one.slice(0, maxLen - 1)}…`;
}

type StoreMap = Record<string, StoredPlanHandoff>;

/** Fallback when localStorage is missing / read-only (some Vitest hosts). */
let memoryStore: StoreMap = {};

function readStore(): StoreMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...memoryStore };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...memoryStore };
    }
    memoryStore = { ...(parsed as StoreMap) };
    return { ...memoryStore };
  } catch {
    return { ...memoryStore };
  }
}

function writeStore(map: StoreMap): void {
  memoryStore = { ...map };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* keep memoryStore */
  }
}

/** Test helper: reset in-memory + best-effort localStorage. */
export function resetPlanHandoffStoreForTests(): void {
  memoryStore = {};
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readPlanHandoff(sessionId: string | null | undefined): StoredPlanHandoff | null {
  const id = sessionId?.trim();
  if (!id) {
    return null;
  }
  const entry = readStore()[id];
  if (!entry?.planText?.trim()) {
    return null;
  }
  return { planText: entry.planText, updatedAt: entry.updatedAt || new Date().toISOString() };
}

export function writePlanHandoff(
  sessionId: string | null | undefined,
  planText: string,
  updatedAt?: string,
): void {
  const id = sessionId?.trim();
  const text = planText.trim();
  if (!id || !text) {
    return;
  }
  const map = readStore();
  map[id] = {
    planText: text.slice(0, 2400),
    updatedAt: updatedAt?.trim() || new Date().toISOString(),
  };
  writeStore(map);
}

export function clearPlanHandoff(sessionId: string | null | undefined): void {
  const id = sessionId?.trim();
  if (!id) {
    return;
  }
  const map = readStore();
  if (!(id in map)) {
    return;
  }
  delete map[id];
  writeStore(map);
}

/**
 * If messages contain a newer plan-like assistant reply, persist it for the session.
 * Returns the stored entry when updated or already present.
 */
export function syncPlanHandoffFromMessages(
  sessionId: string | null | undefined,
  messages: PlanHandoffMessage[],
): StoredPlanHandoff | null {
  const id = sessionId?.trim();
  if (!id) {
    return null;
  }
  const extracted = extractPlanHandoffText(messages);
  if (!extracted) {
    return readPlanHandoff(id);
  }
  const prev = readPlanHandoff(id);
  if (prev?.planText === extracted) {
    return prev;
  }
  // Only auto-save when it looks like a plan (not mere fallback chatter).
  const looksLikePlan =
    PLAN_HINT.test(extracted) || /^\s*(?:[-*]|\d+[.)、])\s+\S/m.test(extracted);
  if (!looksLikePlan && prev) {
    return prev;
  }
  if (!looksLikePlan) {
    return null;
  }
  writePlanHandoff(id, extracted);
  return readPlanHandoff(id);
}

/** Pick newer of local vs server handoff by updatedAt. */
export function preferNewerPlanHandoff(
  a: StoredPlanHandoff | null | undefined,
  b: StoredPlanHandoff | null | undefined,
): StoredPlanHandoff | null {
  if (!a?.planText?.trim()) {
    return b?.planText?.trim() ? b : null;
  }
  if (!b?.planText?.trim()) {
    return a;
  }
  const ta = Date.parse(a.updatedAt || "") || 0;
  const tb = Date.parse(b.updatedAt || "") || 0;
  return tb >= ta ? b : a;
}

export async function fetchSessionPlanHandoff(
  apiBase: string,
  sessionId: string,
): Promise<StoredPlanHandoff | null> {
  const id = sessionId.trim();
  if (!apiBase.trim() || !id) {
    return null;
  }
  try {
    const res = await fetch(
      `${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(id)}/plan-handoff`,
    );
    if (!res.ok) {
      return null;
    }
    const j = (await res.json()) as { ok?: boolean; planHandoff?: StoredPlanHandoff | null };
    if (!j.ok || !j.planHandoff?.planText?.trim()) {
      return null;
    }
    return {
      planText: j.planHandoff.planText,
      updatedAt: j.planHandoff.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function pushSessionPlanHandoff(
  apiBase: string,
  sessionId: string,
  planText: string,
  updatedAt?: string,
): Promise<StoredPlanHandoff | null> {
  const id = sessionId.trim();
  const text = planText.trim();
  if (!apiBase.trim() || !id || !text) {
    return null;
  }
  try {
    const res = await fetch(
      `${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(id)}/plan-handoff`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planText: text.slice(0, 2400),
          ...(updatedAt ? { updatedAt } : {}),
        }),
      },
    );
    if (!res.ok) {
      return null;
    }
    const j = (await res.json()) as { ok?: boolean; planHandoff?: StoredPlanHandoff | null };
    return j.planHandoff?.planText
      ? {
          planText: j.planHandoff.planText,
          updatedAt: j.planHandoff.updatedAt || new Date().toISOString(),
        }
      : null;
  } catch {
    return null;
  }
}

export async function deleteSessionPlanHandoff(
  apiBase: string,
  sessionId: string,
): Promise<void> {
  const id = sessionId.trim();
  if (!apiBase.trim() || !id) {
    return;
  }
  try {
    await fetch(
      `${apiBase.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(id)}/plan-handoff`,
      { method: "DELETE" },
    );
  } catch {
    /* ignore */
  }
}

/**
 * Merge local cache with session.json; write winner back to both when needed.
 */
export async function reconcilePlanHandoffWithServer(
  apiBase: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<StoredPlanHandoff | null> {
  const id = sessionId?.trim();
  if (!id) {
    return null;
  }
  const local = readPlanHandoff(id);
  if (!apiBase?.trim()) {
    return local;
  }
  const remote = await fetchSessionPlanHandoff(apiBase, id);
  const winner = preferNewerPlanHandoff(local, remote);
  if (!winner) {
    return null;
  }
  writePlanHandoff(id, winner.planText, winner.updatedAt);
  const localWon = !remote || preferNewerPlanHandoff(local, remote) === local;
  if (localWon && local?.planText) {
    void pushSessionPlanHandoff(apiBase, id, winner.planText, winner.updatedAt);
  }
  return readPlanHandoff(id);
}
