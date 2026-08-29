/**
 * LawMind legal tool registry (thin facade).
 */
import type { AgentConfig } from "../types.js";
import type { AgentTool } from "../types.js";
import {
  createDelegateTaskTool,
  createDelegateToRoleTool,
  createConsultAssistantTool,
  createNotifyAssistantTool,
  createRequestReviewTool,
  listDelegationsTool,
  getDelegationResultTool,
} from "./collaboration-tools.js";
import { engineTools } from "./engine-tools.js";
import { lawMindDeepResearchTool } from "./lawmind-deep-research.js";
import { lawMindStatuteWebSearchTool } from "./lawmind-legal-web-search.js";
import { lawMindUrlDossierTool } from "./lawmind-url-dossier.js";
import { lawMindWebSearchTool } from "./lawmind-web-search.js";
import { listTasks, listAllDrafts, getAuditTrail } from "./legal/audit-tools.js";
import { calculateTool } from "./legal/calculate-tool.js";
import { renderChart } from "./legal/chart-tool.js";
import { compareDocuments } from "./legal/compare-documents.js";
import { analyzeDocument, writeDocument } from "./legal/file-tools.js";
import { listMoreTools } from "./legal/list-more-tools.js";
import {
  prepareOutboundMail,
  sendEmail,
  listMailInbox,
  listMailAttachments,
} from "./legal/mail-tools.js";
import { getMatterSummary, listMatters, readCaseFile, addCaseNote } from "./legal/matter-tools.js";
import { runAnalysis } from "./legal/run-analysis-tool.js";
import {
  searchMatter,
  searchWorkspace,
  readProjectFile,
  searchStatute,
  searchCaseLaw,
  checkConflictOfInterest,
} from "./legal/search-tools.js";
import { analyzeSpreadsheet, writeSpreadsheet } from "./legal/spreadsheet-tools.js";
import { ToolRegistry } from "./registry.js";

export function createLegalToolRegistry(opts?: {
  allowWebSearch?: boolean;
  enableCollaboration?: boolean;
  baseConfig?: AgentConfig;
  collaborationDepth?: number;
}): ToolRegistry {
  const registry = new ToolRegistry();
  const tools: AgentTool[] = [
    // 信息检索
    searchMatter,
    searchWorkspace,
    readProjectFile,
    searchStatute,
    searchCaseLaw,
    // 案件管理
    getMatterSummary,
    listMatters,
    checkConflictOfInterest,
    readCaseFile,
    addCaseNote,
    // 文件操作
    analyzeDocument,
    compareDocuments,
    analyzeSpreadsheet,
    writeSpreadsheet,
    renderChart,
    calculateTool,
    runAnalysis,
    writeDocument,
    sendEmail,
    prepareOutboundMail,
    listMailInbox,
    listMailAttachments,
    // 状态查看
    listTasks,
    listAllDrafts,
    getAuditTrail,
    listMoreTools,
  ];

  // Deep research uses workspace/authority adapters even without web search.
  tools.push(lawMindDeepResearchTool);
  if (opts?.allowWebSearch) {
    tools.push(lawMindWebSearchTool, lawMindStatuteWebSearchTool, lawMindUrlDossierTool);
  }

  if (opts?.enableCollaboration && opts.baseConfig) {
    tools.push(
      createDelegateTaskTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
      }),
      createDelegateToRoleTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
      }),
      createConsultAssistantTool({ baseConfig: opts.baseConfig }),
      createNotifyAssistantTool({ baseConfig: opts.baseConfig }),
      createRequestReviewTool({ baseConfig: opts.baseConfig }),
      listDelegationsTool,
      getDelegationResultTool,
    );
  }

  tools.push(...engineTools);

  for (const tool of tools) {
    registry.register(tool);
  }
  return registry;
}
