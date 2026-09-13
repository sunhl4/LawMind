/**
 * Turn-plan types and parse/progress helpers.
 *
 * Renderer-safe: no Node builtins. World-state writes live in `turn-plan.ts`.
 */

export const UPDATE_PLAN_TOOL_NAME = "update_plan";

export const TURN_PLAN_MIN_STEPS = 2;
export const TURN_PLAN_MAX_STEPS = 8;
export const TURN_PLAN_STEP_MAX_CHARS = 36;
export const TURN_PLAN_EXPLANATION_MAX_CHARS = 80;

export type TurnPlanStepStatus = "pending" | "in_progress" | "completed";

export type TurnPlanItem = {
  step: string;
  status: TurnPlanStepStatus;
};

export type AgentTurnPlan = {
  items: TurnPlanItem[];
  explanation?: string;
  updatedAt: string;
};

const STATUS_ALIASES: Record<string, TurnPlanStepStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  completed: "completed",
  complete: "completed",
  待办: "pending",
  未开始: "pending",
  进行中: "in_progress",
  已完成: "completed",
  完成: "completed",
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clipChars(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max).trimEnd()}…`;
}

function coercePlanArray(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseStatus(raw: unknown): TurnPlanStepStatus | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? STATUS_ALIASES[raw.trim()];
}

function parseItem(raw: unknown): TurnPlanItem | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const rec = raw as Record<string, unknown>;
  const stepRaw =
    typeof rec.step === "string" ? rec.step : typeof rec.text === "string" ? rec.text : "";
  const step = clipChars(stepRaw, TURN_PLAN_STEP_MAX_CHARS);
  const status = parseStatus(rec.status);
  if (!step || !status) {
    return undefined;
  }
  return { step, status };
}

export function turnPlanProgress(plan: AgentTurnPlan): { completed: number; total: number } {
  const total = plan.items.length;
  const completed = plan.items.filter((item) => item.status === "completed").length;
  return { completed, total };
}

export function isTurnPlanComplete(plan: AgentTurnPlan | undefined): boolean {
  if (!plan || plan.items.length === 0) {
    return false;
  }
  return plan.items.every((item) => item.status === "completed");
}

export function formatTurnPlanWorldState(plan: AgentTurnPlan): string {
  const attrs = plan.explanation
    ? ` explanation="${escapeXml(clipChars(plan.explanation, TURN_PLAN_EXPLANATION_MAX_CHARS))}"`
    : "";
  const lines = plan.items.map(
    (item) => `  <step status="${item.status}">${escapeXml(item.step)}</step>`,
  );
  return `<turn_plan${attrs}>\n${lines.join("\n")}\n</turn_plan>`;
}

export function validateUpdatePlanArgs(
  params: Record<string, unknown>,
): { ok: true; plan: AgentTurnPlan } | { ok: false; error: string } {
  const rawItems = coercePlanArray(params.plan) ?? coercePlanArray(params.items);
  if (!rawItems) {
    return { ok: false, error: "请提供 plan：2–8 步，每步含 step 与 status。" };
  }
  if (rawItems.length < TURN_PLAN_MIN_STEPS || rawItems.length > TURN_PLAN_MAX_STEPS) {
    return {
      ok: false,
      error: `本轮清单须为 ${TURN_PLAN_MIN_STEPS}–${TURN_PLAN_MAX_STEPS} 步，当前 ${rawItems.length} 步。`,
    };
  }
  const items: TurnPlanItem[] = [];
  for (const row of rawItems) {
    const item = parseItem(row);
    if (!item) {
      return {
        ok: false,
        error: "每一步需要短句 step，以及 status（pending / in_progress / completed）。",
      };
    }
    items.push(item);
  }
  const inProgress = items.filter((item) => item.status === "in_progress").length;
  if (inProgress > 1) {
    return { ok: false, error: "同时最多一步 in_progress。" };
  }
  if (inProgress === 0 && !items.every((item) => item.status === "completed")) {
    return { ok: false, error: "未全部完成时须有且仅有一步 in_progress。" };
  }
  const explanationRaw = typeof params.explanation === "string" ? params.explanation.trim() : "";
  const explanation = explanationRaw
    ? clipChars(explanationRaw, TURN_PLAN_EXPLANATION_MAX_CHARS)
    : undefined;
  return {
    ok: true,
    plan: {
      items,
      ...(explanation ? { explanation } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function parseAgentTurnPlan(data: unknown): AgentTurnPlan | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const rec = data as Record<string, unknown>;
  const nested = rec.plan;
  if (nested && typeof nested === "object" && !Array.isArray(nested) && "items" in nested) {
    return parseAgentTurnPlan(nested);
  }
  const itemsRaw = coercePlanArray(rec.items) ?? coercePlanArray(rec.plan);
  if (!itemsRaw) {
    return undefined;
  }
  const parsed = validateUpdatePlanArgs({
    plan: itemsRaw,
    explanation: rec.explanation,
  });
  if (!parsed.ok) {
    return undefined;
  }
  if (typeof rec.updatedAt === "string" && rec.updatedAt.trim()) {
    return { ...parsed.plan, updatedAt: rec.updatedAt.trim() };
  }
  return parsed.plan;
}

export function pruneTurnPlanForNewInstruction(
  plan: AgentTurnPlan | undefined,
  instruction: string,
): AgentTurnPlan | undefined {
  if (!plan) {
    return undefined;
  }
  if (/【从检查点继续】/.test(instruction)) {
    return plan;
  }
  if (isTurnPlanComplete(plan)) {
    return undefined;
  }
  return plan;
}

/**
 * Timeout middleware shallow-copies ctx for per-call abort signals.
 * Write the plan onto the shared ctx from the tool result, matching craft-patch promote.
 */
export function promotePendingTurnPlan(
  ctx: { pendingTurnPlan?: AgentTurnPlan },
  data: unknown,
): AgentTurnPlan | undefined {
  const plan = parseAgentTurnPlan(data) ?? ctx.pendingTurnPlan;
  if (plan) {
    ctx.pendingTurnPlan = plan;
  }
  return plan;
}

/** Codex returns a short receipt; the checklist itself lives in world-state / UI. */
export function summarizeUpdatePlanResultForHistory(result: {
  ok: boolean;
  data?: unknown;
  error?: string;
}): { ok: false; error?: string } | { ok: true; data: { message: string } } {
  if (!result.ok) {
    return { ok: false, ...(result.error ? { error: result.error } : {}) };
  }
  const message =
    result.data &&
    typeof result.data === "object" &&
    typeof (result.data as { message?: unknown }).message === "string"
      ? (result.data as { message: string }).message.trim()
      : "清单已更新";
  return { ok: true, data: { message: message || "清单已更新" } };
}

export function attachTurnPlanToLastAssistant(session: {
  conversationHistory: Array<{ role: string; turnPlan?: AgentTurnPlan }>;
  turnPlan?: AgentTurnPlan;
}): void {
  if (!session.turnPlan) {
    return;
  }
  for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
    const row = session.conversationHistory[i];
    if (row.role !== "assistant") {
      continue;
    }
    row.turnPlan = session.turnPlan;
    break;
  }
}

export function withUpdatePlanControlTool(
  names: string[] | undefined,
  registeredNames?: Iterable<string>,
): string[] | undefined {
  if (!names || names.length === 0) {
    return names;
  }
  if (registeredNames) {
    const registered = new Set(registeredNames);
    if (!registered.has(UPDATE_PLAN_TOOL_NAME)) {
      return names;
    }
  }
  if (names.includes(UPDATE_PLAN_TOOL_NAME)) {
    return names;
  }
  return [...names, UPDATE_PLAN_TOOL_NAME];
}
