/**
 * True-loop cassette harness (TestLawMindBuilder).
 *
 * Import from tests only. Production agent/index.ts does not re-export this.
 */

export {
  ModelRequestSnapshot,
  parseChatCompletionsBody,
  snapshotFromRawBody,
  type ChatCompletionsMessage,
  type ChatCompletionsRequestBody,
} from "./cassette-inspect.js";
export {
  cassetteAssistant,
  cassetteHttpError,
  cassetteToolCall,
  cassetteToolCalls,
  lastDraftTaskIdFromRequestBody,
  resolveRuntimeTokens,
  type CassetteRound,
  type CassetteToolCall,
} from "./cassette-script.js";
export {
  startCassetteModelServer,
  type CassetteModelServer,
  type CassetteModelServerOptions,
} from "./cassette-model-server.js";
export {
  createGateSpyRegistry,
  type GateSpyLog,
  type GateSpyRegistry,
  type SpyToolCall,
} from "./gate-spy-registry.js";
export {
  TestLawMind,
  TestLawMindBuilder,
  withTestLawMind,
  type TestLawMindTurnOpts,
} from "./test-lawmind.js";
