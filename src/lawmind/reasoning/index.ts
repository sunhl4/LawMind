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
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildLegalGraphParams,
} from "./legal-graph.js";
