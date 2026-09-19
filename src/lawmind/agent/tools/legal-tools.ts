/**
 * LawMind legal tool registry (thin facade).
 */
import { loadAssistantProfiles, resolveLawMindRoot } from "../../assistants/store.js";
import { buildCollaborationPolicyFromAssistants } from "../collaboration/collaboration-policy-from-org.js";
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
import { searchCompanyRegistry } from "./legal/company-registry-tool.js";
import { compareDocuments } from "./legal/compare-documents.js";
import { deskTools } from "./legal/desk-tools.js";
import { draftWorkerTool } from "./legal/draft-worker-tool.js";
import { exploreFolderTool } from "./legal/explore-folder-tool.js";
import { analyzeDocument, writeDocument } from "./legal/file-tools.js";
import {
  importHostFileTool,
  readHostFileTool,
  runHostCommandTool,
  searchHostTool,
} from "./legal/host-tools.js";
import { listDirTool } from "./legal/list-dir-tool.js";
import { listMoreTools } from "./legal/list-more-tools.js";
import {
  prepareOutboundMail,
  sendEmail,
  listMailInbox,
  listMailAttachments,
} from "./legal/mail-tools.js";
import { getMatterSummary, listMatters, readCaseFile, addCaseNote } from "./legal/matter-tools.js";
import { readSkillTool } from "./legal/read-skill-tool.js";
import { runAnalysis } from "./legal/run-analysis-tool.js";
import { runCompute } from "./legal/run-compute-tool.js";
import {
  searchMatter,
  searchWorkspace,
  searchConversationsTool,
  readConversationTool,
  readProjectFile,
  searchStatute,
  searchCaseLaw,
  checkConflictOfInterest,
} from "./legal/search-tools.js";
import { analyzeSpreadsheet, writeSpreadsheet } from "./legal/spreadsheet-tools.js";
import { updatePlanTool } from "./legal/update-plan-tool.js";
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
    searchConversationsTool,
    readConversationTool,
    readProjectFile,
    listDirTool,
    exploreFolderTool,
    searchHostTool,
    readHostFileTool,
    importHostFileTool,
    runHostCommandTool,
    searchStatute,
    searchCaseLaw,
    searchCompanyRegistry,
    // 案件管理
    getMatterSummary,
    listMatters,
    checkConflictOfInterest,
    readCaseFile,
    addCaseNote,
    ...deskTools,
    // 文件操作
    analyzeDocument,
    compareDocuments,
    analyzeSpreadsheet,
    writeSpreadsheet,
    renderChart,
    calculateTool,
    runCompute,
    runAnalysis,
    writeDocument,
    draftWorkerTool,
    sendEmail,
    prepareOutboundMail,
    listMailInbox,
    listMailAttachments,
    // 状态查看
    listTasks,
    listAllDrafts,
    getAuditTrail,
    listMoreTools,
    readSkillTool,
    updatePlanTool,
  ];

  // Deep research uses workspace/authority adapters even without web search.
  tools.push(lawMindDeepResearchTool);
  if (opts?.allowWebSearch) {
    tools.push(lawMindWebSearchTool, lawMindStatuteWebSearchTool, lawMindUrlDossierTool);
  }

  if (opts?.enableCollaboration && opts.baseConfig) {
    const lawMindRoot = resolveLawMindRoot(opts.baseConfig.workspaceDir, opts.baseConfig.envFile);
    let collabPolicy;
    try {
      collabPolicy = buildCollaborationPolicyFromAssistants(loadAssistantProfiles(lawMindRoot));
    } catch {
      collabPolicy = undefined;
    }
    tools.push(
      createDelegateTaskTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
        policy: collabPolicy,
      }),
      createDelegateToRoleTool({
        baseConfig: opts.baseConfig,
        currentDepth: opts.collaborationDepth ?? 0,
        policy: collabPolicy,
      }),
      createConsultAssistantTool({ baseConfig: opts.baseConfig, policy: collabPolicy }),
      createNotifyAssistantTool({ baseConfig: opts.baseConfig }),
      createRequestReviewTool({ baseConfig: opts.baseConfig, policy: collabPolicy }),
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
