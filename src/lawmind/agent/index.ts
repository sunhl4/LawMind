/**
 * LawMind Agent — 模块入口
 *
 * 暴露 agent 的完整 API：
 *   - createLawMindAgent: 创建 agent 实例
 *   - runTurn: 单次推理循环
 *   - session 管理
 *   - tool registry
 */

export { createLawMindAgent, type LawMindAgent } from "./agent-factory.js";

// Re-export all types for external consumption
export type {
  AgentConfig,
  AgentModelConfig,
  AgentContext,
  AgentMessage,
  AgentSession,
  AgentTurn,
  AgentTurnStatus,
  ToolDefinition,
  ToolCallResult,
  ToolExecutor,
  AgentTool,
  ToolCall,
  ToolCallResponse,
} from "./types.js";

export { ToolRegistry, createLegalToolRegistry } from "./tools/index.js";
export { runTurn } from "./runtime.js";
export { resumeTurn } from "./runtime-resume.js";
export type { RunTurnEvent } from "./runtime.js";
export {
  createSession,
  loadSession,
  saveSession,
  listSessions,
  loadTurns,
  appendTurn,
  compactHistory,
} from "./session.js";
export { buildSystemPrompt } from "./system-prompt.js";

// Collaboration (inter-assistant communication)
export {
  DEFAULT_COLLABORATION_POLICY,
  sendAndWait,
  fireAndForget,
  wrapUntrustedResult,
  buildCollaborationMessage,
  registerDelegation,
  listDelegations,
  getDelegation,
  restoreDelegationsFromDisk,
  emitCollaborationEvent,
  readCollaborationEvents,
  loadCollaborationContext,
  saveCollaborationArtifact,
  buildCollaborationSummary,
} from "./collaboration/index.js";
export type {
  CollaborationMessage,
  CollaborationEvent,
  CollaborationPolicy,
  DelegationRecord,
  ReviewType,
  ReviewFeedback,
  CollaborationContext,
} from "./collaboration/index.js";

// Orchestrator (multi-assistant workflow)
export {
  executeWorkflow,
  buildWorkflowReport,
  parseAndBuildWorkflow,
  parseDirectiveHeuristic,
  buildWorkflowFromDirective,
} from "./orchestrator/index.js";
export type {
  CollaborationWorkflow,
  WorkflowStep,
  WorkflowStatus,
  ParsedDirective,
  ExecuteWorkflowOptions,
  WorkflowRunProgress,
} from "./orchestrator/index.js";
