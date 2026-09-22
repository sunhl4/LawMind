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
  detectLegalTopic,
  IRAC_SOURCE_KIND_COVERAGE,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
  type BuildLegalGraphParams,
} from "./legal-graph.js";
export {
  DEFAULT_DERIVED_FACTS_LIMIT,
  DERIVED_FACTS_CAP_TOKENS,
  DERIVED_FACTS_MAX_CHARS,
  DERIVED_FACTS_MAX_FILES,
  MAX_FACTS_BLOCK_CHARS,
  addPeriod,
  collectDerivedFacts,
  computeDeadlineFact,
  computeDeliverableScopeFact,
  computeDepositCapFact,
  computeLimitationDeadlineFact,
  computePaymentRatioSumFact,
  computePaymentSumFact,
  computePenaltyAsymmetryFact,
  computeTotalConsistencyFact,
  computeUnitPriceFact,
  describeDerivedFacts,
  findExplicitDates,
  findMoneyAmounts,
  findOverduePenaltyTerms,
  findPaymentItems,
  formatDerivedFactsPromptBlock,
  loadDerivedFactsForMatter,
  resolveDocumentGenre,
  sentenceAfter,
  sentenceAround,
  sentenceBefore,
  type DerivedFact,
  type DerivedFactsOptions,
  type ExplicitDate,
  type MoneyHit,
  type PaymentItem,
  type PenaltyTerm,
  type PeriodSpan,
} from "./derived-facts.js";
