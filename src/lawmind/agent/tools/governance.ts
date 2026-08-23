import type { RiskLevel } from "../../types.js";
import { toolRequiresSubprocessSandbox } from "../dangerous-tool-policy.js";
import { filterToolsForPermissionMode, type AgentPermissionMode } from "../permission-mode.js";
import {
  BACKGROUND_JOB_TOOLS,
  IDEMPOTENT_READ_TOOLS,
  MATTER_SCOPE_REQUIRED,
  WRITE_TOOLS,
} from "../tool-name-sets.js";
import type { AgentTool, ToolDefinition } from "../types.js";
import { ToolRegistry } from "./registry.js";

/** Always-on model tools. Source of truth for prompt catalog + OpenAI tools. */
export const CORE_MODEL_TOOL_NAMES = [
  "analyze_document",
  "apply_surgical_edits",
  "list_mail_inbox",
  "prepare_outbound_mail",
  "read_project_file",
  "render_document",
  "request_approval",
  "research_task",
  "search_matter",
  "search_statute",
  "update_draft",
  "write_document",
] as const;

export const LIST_MORE_TOOLS_NAME = "list_more_tools";

export function promptCatalogToolNames(): string[] {
  return [...CORE_MODEL_TOOL_NAMES, LIST_MORE_TOOLS_NAME].toSorted((a, b) => a.localeCompare(b));
}

export function resolveModelToolNames(opts: {
  registeredNames: Iterable<string>;
  allowNames?: string[];
  permissionMode?: AgentPermissionMode;
  disclosedNames?: string[];
}): string[] {
  const registered = new Set(opts.registeredNames);
  const core = promptCatalogToolNames().filter((name) => registered.has(name));
  const disclosed = (opts.disclosedNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && registered.has(name) && !core.includes(name));
  let names = [...core, ...disclosed];
  if (opts.allowNames && opts.allowNames.length > 0) {
    const allow = new Set(opts.allowNames);
    names = names.filter((name) => allow.has(name) || name === LIST_MORE_TOOLS_NAME);
  }
  names = filterToolsForPermissionMode(names, opts.permissionMode ?? "standard");
  if (registered.has(LIST_MORE_TOOLS_NAME) && !names.includes(LIST_MORE_TOOLS_NAME)) {
    const mode = opts.permissionMode ?? "standard";
    if (mode === "standard" || mode === "strict") {
      names.push(LIST_MORE_TOOLS_NAME);
    }
  }
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
      const disclosed = (data as { disclosedName?: unknown }).disclosedName;
      if (typeof disclosed === "string" && disclosed.trim()) {
        found.push(disclosed.trim());
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

function resolveRiskLevel(definition: ToolDefinition): RiskLevel {
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
  const riskLevel = resolveRiskLevel(definition);
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
