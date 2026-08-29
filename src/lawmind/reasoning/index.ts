/**
 * Reasoning Layer
 *
 * 将 ResearchBundle 整理为 ArtifactDraft。
 * - 默认：keyword-draft 规则驱动
 * - 可选：LAWMIND_REASONING_MODE=model + LLM 凭据，使用 buildDraftAsync()
 */

export { buildDraft, type BuildDraftParams } from "./keyword-draft.js";
export { buildDraftAsync, buildDraftWithModel, isModelReasoningEnabled } from "./model-draft.js";
export {
  applyDraftCritic,
  applyDraftCriticAsync,
  DRAFT_CRITIC_PREFIX,
  hasCriticNotes,
  runDraftCritic,
  runDraftCriticAsync,
} from "./draft-critic.js";
export {
  attachClauseCriticNotes,
  buildClauseGraphFromDraft,
  clauseGraphHeadline,
  type ClauseGraph,
  type ClauseNode,
} from "./clause-graph.js";
export {
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildLegalGraphParams,
} from "./legal-graph.js";
