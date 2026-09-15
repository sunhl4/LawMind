/**
 * Codex-style turn checklist (`update_plan`).
 *
 * Bounded 2–8 steps written to world-state so compact / later tool rounds
 * still see the goal. Not `plan_task`, not `execute_workflow`, not planHandoff.
 *
 * Parse/progress helpers are in `turn-plan-model.ts` so the desktop renderer
 * can import them without pulling `node:crypto` via world-state hashes.
 */

import { formatTurnPlanWorldState, type AgentTurnPlan } from "./turn-plan-model.js";
import {
  collectWorldStateHashes,
  upsertWorldStateSection,
  type WorldStateBaseline,
} from "./world-state.js";

export {
  UPDATE_PLAN_TOOL_NAME,
  TURN_PLAN_MIN_STEPS,
  TURN_PLAN_MAX_STEPS,
  TURN_PLAN_STEP_MAX_CHARS,
  TURN_PLAN_EXPLANATION_MAX_CHARS,
  attachTurnPlanToLastAssistant,
  formatTurnPlanWorldState,
  formatTurnPlanExecuteText,
  isTurnPlanComplete,
  parseAgentTurnPlan,
  promotePendingTurnPlan,
  pruneTurnPlanForNewInstruction,
  summarizeUpdatePlanResultForHistory,
  turnPlanProgress,
  validateUpdatePlanArgs,
  withUpdatePlanControlTool,
} from "./turn-plan-model.js";
export type { AgentTurnPlan, TurnPlanItem, TurnPlanStepStatus } from "./turn-plan-model.js";

export type TurnPlanHost = {
  conversationHistory: Array<{ role: string; content: string; turnPlan?: AgentTurnPlan }>;
  worldStateBaseline?: WorldStateBaseline;
  worldStateEpoch?: number;
  turnPlan?: AgentTurnPlan;
};

export function applyPendingTurnPlan(
  session: TurnPlanHost,
  ctx: { pendingTurnPlan?: AgentTurnPlan },
): boolean {
  const plan = ctx.pendingTurnPlan;
  if (!plan) {
    return false;
  }
  ctx.pendingTurnPlan = undefined;
  session.turnPlan = plan;
  const sys = session.conversationHistory.find((m) => m.role === "system");
  if (sys) {
    sys.content = upsertWorldStateSection(sys.content, "plan", formatTurnPlanWorldState(plan));
    session.worldStateBaseline = collectWorldStateHashes(sys.content);
    session.worldStateEpoch = (session.worldStateEpoch ?? 0) + 1;
  }
  return true;
}
