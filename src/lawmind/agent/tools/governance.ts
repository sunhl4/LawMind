import type { RiskLevel } from "../../types.js";
import { toolRequiresSubprocessSandbox } from "../dangerous-tool-policy.js";
import type { AgentTool, ToolDefinition } from "../types.js";
import { ToolRegistry } from "./registry.js";
import {
  BACKGROUND_JOB_TOOLS,
  IDEMPOTENT_READ_TOOLS,
  MATTER_SCOPE_REQUIRED,
  WRITE_TOOLS,
} from "../tool-name-sets.js";

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
