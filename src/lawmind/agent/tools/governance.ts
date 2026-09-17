import type { RiskLevel } from "../../types.js";
import { toolRequiresSubprocessSandbox } from "../dangerous-tool-policy.js";
import { filterToolsForPermissionMode, type AgentPermissionMode } from "../permission-mode.js";
import {
  BACKGROUND_JOB_TOOLS,
  IDEMPOTENT_READ_TOOLS,
  MATTER_SCOPE_REQUIRED,
  WRITE_TOOLS,
} from "../tool-name-sets.js";
import { UPDATE_PLAN_TOOL_NAME } from "../turn-plan.js";
import type { AgentTool, ToolDefinition } from "../types.js";
import { ToolRegistry } from "./registry.js";

/** Always-on model tools (≤12). Source of truth for prompt catalog + OpenAI tools. */
export const CORE_MODEL_TOOL_NAMES = [
  "analyze_document",
  "apply_surgical_edits",
  "calculate",
  "draft_document",
  "prepare_outbound_mail",
  "read_project_file",
  "render_document",
  "request_approval",
  "research_task",
  "search_case_law",
  "search_statute",
  "update_draft",
] as const;

export const LIST_MORE_TOOLS_NAME = "list_more_tools";
export { UPDATE_PLAN_TOOL_NAME };

export function promptCatalogToolNames(): string[] {
  return [...CORE_MODEL_TOOL_NAMES, LIST_MORE_TOOLS_NAME, UPDATE_PLAN_TOOL_NAME].toSorted((a, b) =>
    a.localeCompare(b),
  );
}

export const DISCLOSED_TOOL_HINTS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: "execute_workflow", hint: "按需启动确定性办案管线（检索→起草→审批）" },
  { name: "deep_research", hint: "长时深度检索（联网开启时含公开网页）" },
  { name: "delegate_task", hint: "把子任务交给另一位助手" },
  { name: "render_tracked_draft", hint: "导出带审阅痕迹的 Word" },
  { name: "send_email", hint: "发送已准备的外发邮件（须律师签批）" },
  { name: "write_document", hint: "写入工作区普通文件（正式交件请用 draft_document）" },
  { name: "list_mail_inbox", hint: "查看本案邮件匣" },
  { name: "search_matter", hint: "在本案卷宗里检索" },
  { name: "list_templates", hint: "查看可用文书模板" },
  { name: "notify_assistant", hint: "会议室 / 同事通知" },
  { name: "plan_task", hint: "先拆步骤再执行" },
  { name: "search_workspace", hint: "跨工作区检索材料" },
  { name: "search_conversations", hint: "检索本机其他对话的要点与做法" },
  { name: "read_conversation", hint: "阅读某次历史对话里律师可见的发言" },
  { name: "search_host", hint: "在本机文件夹或本机查找中定位材料" },
  { name: "read_host_file", hint: "阅读已授权的本机文件" },
  { name: "list_dir", hint: "列举工作区或本机文件夹下的目录与文件（可递归）" },
  { name: "explore_folder", hint: "只读探查文件夹：看清树、找出相关文件并摘录" },
  { name: "draft_worker", hint: "并行写稿：按自包含任务书起草一节，父会话再汇总" },
  { name: "import_host_file", hint: "把本机文件收进本案" },
  { name: "run_host_command", hint: "运行受控本机命令（须打开本机能力）" },
  { name: "compare_documents", hint: "只读对比两份文件的文本差异" },
  { name: "web_search", hint: "联网检索公开网页" },
  { name: "search_statute_web", hint: "官方法规站点优先的联网检索" },
  { name: "url_dossier", hint: "抓取律师给出的公开 URL 做成卷宗" },
  { name: "analyze_spreadsheet", hint: "分析钉选或工作区 Excel 的列、类型与统计" },
  { name: "write_spreadsheet", hint: "把二维表写入本案或工作区交付目录下的 xlsx" },
  { name: "render_chart", hint: "按声明式规格出图（助手正文用 lm-chart 围栏）" },
  { name: "run_compute", hint: "后台核算：当场写 JS 出表/图，律师只看交件" },
  { name: "run_analysis", hint: "预置分析脚本（须政策开启）" },
  { name: "read_skill", hint: "按需读取索引里的技能正文" },
  { name: "search_company_registry", hint: "查企业登记；未接工商源时诚实标【待核实】" },
];

export function resolveModelToolNames(opts: {
  registeredNames: Iterable<string>;
  allowNames?: string[];
  permissionMode?: AgentPermissionMode;
  disclosedNames?: string[];
  /** Advertise exactly allowNames (registered ∩ permission). No core catalog, no list_more_tools. */
  lockToAllowNames?: boolean;
  /** Never advertise these names (mail/word playbook deny-list). */
  denyNames?: string[];
}): string[] {
  const registered = new Set(opts.registeredNames);
  const deny = new Set(
    (opts.denyNames ?? []).map((name) => name.trim()).filter((name) => name.length > 0),
  );
  const applyDeny = (names: string[]): string[] =>
    deny.size === 0 ? names : names.filter((name) => !deny.has(name));
  const appendControlPlan = (names: string[]): string[] => {
    if (
      names.length > 0 &&
      registered.has(UPDATE_PLAN_TOOL_NAME) &&
      !names.includes(UPDATE_PLAN_TOOL_NAME)
    ) {
      names.push(UPDATE_PLAN_TOOL_NAME);
    }
    return names;
  };
  if (opts.lockToAllowNames) {
    const locked = (opts.allowNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && registered.has(name));
    return [
      ...new Set(
        applyDeny(
          appendControlPlan(
            filterToolsForPermissionMode(locked, opts.permissionMode ?? "standard"),
          ),
        ),
      ),
    ].toSorted((a, b) => a.localeCompare(b));
  }
  const core = promptCatalogToolNames().filter((name) => registered.has(name));
  const disclosed = (opts.disclosedNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && registered.has(name) && !core.includes(name));
  let names = [...core, ...disclosed];
  if (opts.allowNames && opts.allowNames.length > 0) {
    const allow = new Set(opts.allowNames);
    names = names.filter(
      (name) => allow.has(name) || name === LIST_MORE_TOOLS_NAME || name === UPDATE_PLAN_TOOL_NAME,
    );
  }
  names = filterToolsForPermissionMode(names, opts.permissionMode ?? "standard");
  if (registered.has(LIST_MORE_TOOLS_NAME) && !names.includes(LIST_MORE_TOOLS_NAME)) {
    const mode = opts.permissionMode ?? "standard";
    if (mode === "standard" || mode === "strict") {
      names.push(LIST_MORE_TOOLS_NAME);
    }
  }
  names = applyDeny(appendControlPlan(names));
  return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
}

export function collectDisclosedToolNames(input: {
  disclosedToolNames?: string[];
  conversationHistory?: Array<{
    toolCallResponses?: Array<{ name?: string; result?: { data?: unknown } }>;
  }>;
}): string[] {
  const found: string[] = [];
  for (const name of input.disclosedToolNames ?? []) {
    if (typeof name === "string" && name.trim()) {
      found.push(name.trim());
    }
  }
  for (const msg of input.conversationHistory ?? []) {
    for (const resp of msg.toolCallResponses ?? []) {
      if (resp.name !== LIST_MORE_TOOLS_NAME) {
        continue;
      }
      const data = resp.result?.data;
      if (!data || typeof data !== "object") {
        continue;
      }
      const rec = data as { disclosedName?: unknown; disclosedNames?: unknown };
      if (typeof rec.disclosedName === "string" && rec.disclosedName.trim()) {
        found.push(rec.disclosedName.trim());
      }
      if (Array.isArray(rec.disclosedNames)) {
        for (const name of rec.disclosedNames) {
          if (typeof name === "string" && name.trim()) {
            found.push(name.trim());
          }
        }
      }
    }
  }
  return [...new Set(found)];
}

export type ToolRuntimeMode = "readonly" | "lawyer_approved_write" | "background_job";
export type ToolMatterScope = "required" | "optional" | "not_applicable";

export type ToolGovernanceMetadata = {
  name: string;
  category: ToolDefinition["category"];
  riskLevel: RiskLevel;
  matterScope: ToolMatterScope;
  runtimeMode: ToolRuntimeMode;
  idempotent: boolean;
  retryable: boolean;
  auditEventKind: "tool_call";
  requiresApproval: boolean;
  sandboxRecommended: boolean;
  policyReason: string;
};

export { MATTER_SCOPE_REQUIRED, BACKGROUND_JOB_TOOLS, IDEMPOTENT_READ_TOOLS, WRITE_TOOLS };

/** 工具风险推导（governance 元数据与 tool-pipeline riskCeiling 共用的单一口径）。 */
export function resolveToolRiskLevel(definition: ToolDefinition): RiskLevel {
  if (definition.riskLevel) {
    return definition.riskLevel;
  }
  if (definition.requiresApproval || WRITE_TOOLS.has(definition.name)) {
    return "medium";
  }
  return "low";
}

function resolveMatterScope(definition: ToolDefinition): ToolMatterScope {
  if (MATTER_SCOPE_REQUIRED.has(definition.name)) {
    return "required";
  }
  if (
    definition.parameters.matter_id ||
    definition.parameters.matterId ||
    definition.category === "matter" ||
    definition.category === "draft" ||
    definition.category === "review"
  ) {
    return "optional";
  }
  return "not_applicable";
}

function resolveRuntimeMode(definition: ToolDefinition): ToolRuntimeMode {
  if (BACKGROUND_JOB_TOOLS.has(definition.name)) {
    return "background_job";
  }
  if (definition.requiresApproval || WRITE_TOOLS.has(definition.name)) {
    return "lawyer_approved_write";
  }
  return "readonly";
}

function buildPolicyReason(params: {
  definition: ToolDefinition;
  riskLevel: RiskLevel;
  matterScope: ToolMatterScope;
  runtimeMode: ToolRuntimeMode;
}): string {
  if (params.runtimeMode === "background_job") {
    return "Long-running legal work must expose job state, cancellation, and audit trail.";
  }
  if (params.runtimeMode === "lawyer_approved_write") {
    return "This tool can change workspace state or produce a deliverable, so lawyer approval and audit context must remain visible.";
  }
  if (params.matterScope === "required") {
    return "This read tool is safe only inside an explicit matter scope.";
  }
  if (params.riskLevel === "high") {
    return "High-risk legal analysis requires stricter review and provenance even when read-only.";
  }
  return "Read-only tool with standard tool_call audit coverage.";
}

export function buildToolGovernanceMetadata(tool: AgentTool): ToolGovernanceMetadata {
  const definition = tool.definition;
  const riskLevel = resolveToolRiskLevel(definition);
  const matterScope = resolveMatterScope(definition);
  const runtimeMode = resolveRuntimeMode(definition);
  const idempotent = IDEMPOTENT_READ_TOOLS.has(definition.name) || runtimeMode === "readonly";
  return {
    name: definition.name,
    category: definition.category,
    riskLevel,
    matterScope,
    runtimeMode,
    idempotent,
    retryable: idempotent && runtimeMode !== "background_job",
    auditEventKind: "tool_call",
    requiresApproval: definition.requiresApproval === true || runtimeMode !== "readonly",
    sandboxRecommended: toolRequiresSubprocessSandbox(definition.name),
    policyReason: buildPolicyReason({ definition, riskLevel, matterScope, runtimeMode }),
  };
}

export function listToolGovernanceMetadata(registry: ToolRegistry): ToolGovernanceMetadata[] {
  return registry
    .listTools()
    .map(buildToolGovernanceMetadata)
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
