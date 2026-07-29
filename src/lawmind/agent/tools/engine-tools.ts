/**
 * Engine-Bridge Tools — barrel re-export.
 */
export { buildLawMindRetrievalAdaptersFromEnvForTest } from "./engine/engine-tool-shared.js";
export {
  planTask,
  researchTask,
  updateDraft,
  draftDocument,
  renderDocument,
} from "./engine/engine-pipeline-tools.js";
export { executeWorkflow } from "./engine/engine-workflow-tool.js";
export { registerTemplate, listTemplates, setTemplateEnabled } from "./engine/engine-template-tools.js";
export {
  openWorkQueueItem,
  requestApprovalTool,
  recordDeadlineTool,
  appendSessionSummaryTool,
} from "./engine/engine-governance-tools.js";
import type { AgentTool } from "../types.js";
import {
  openWorkQueueItem,
  requestApprovalTool,
  recordDeadlineTool,
  appendSessionSummaryTool,
} from "./engine/engine-governance-tools.js";
import {
  planTask,
  researchTask,
  updateDraft,
  draftDocument,
  renderDocument,
} from "./engine/engine-pipeline-tools.js";
import { registerTemplate, listTemplates, setTemplateEnabled } from "./engine/engine-template-tools.js";
import { executeWorkflow } from "./engine/engine-workflow-tool.js";

export const engineTools: AgentTool[] = [
  planTask,
  researchTask,
  updateDraft,
  draftDocument,
  renderDocument,
  executeWorkflow,
  registerTemplate,
  listTemplates,
  setTemplateEnabled,
  openWorkQueueItem,
  requestApprovalTool,
  recordDeadlineTool,
  appendSessionSummaryTool,
];
