/**
 * Reasoning Layer
 *
 * 将 ResearchBundle 整理为 ArtifactDraft。
 * - 默认：有 LLM 凭据时 buildDraftAsync() 模型成稿；无凭据或 LAWMIND_REASONING_MODE=keyword 回退骨架
 * - 同步 buildDraft() 仍是规则骨架（测试 / 断网），验收层不得把骨架标成已验收
 */

export {
  buildBundleTailSections,
  buildDraft,
  buildDraftShell,
  type BuildDraftParams,
} from "./keyword-draft.js";
export {
  buildDraftAsync,
  buildDraftWithModel,
  isModelReasoningEnabled,
  reportedReasoningMode,
} from "./model-draft.js";
export {
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildLegalGraphParams,
} from "./legal-graph.js";
