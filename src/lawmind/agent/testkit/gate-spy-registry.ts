/**
 * Spy tool table with production tool *names* so locks, permission modes,
 * and approval gates fire. Execute is a recorder — shadow replay owns real draft_document.
 */

import { exploreFolderTool } from "../tools/legal/explore-folder-tool.js";
import { updatePlanTool } from "../tools/legal/update-plan-tool.js";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentTool, ToolCallResult, ToolDefinition } from "../types.js";

export type SpyToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: ToolCallResult;
};

export type GateSpyLog = {
  calls: SpyToolCall[];
  executedNames: () => string[];
};

type SpySpec = {
  name: string;
  category: ToolDefinition["category"];
  requiresApproval?: boolean;
  riskLevel?: ToolDefinition["riskLevel"];
  parameters?: ToolDefinition["parameters"];
};

const SPY_SPECS: SpySpec[] = [
  { name: "analyze_document", category: "analyze", riskLevel: "low" },
  { name: "write_document", category: "draft", riskLevel: "medium" },
  { name: "search_workspace", category: "search", riskLevel: "low" },
  { name: "search_matter", category: "search", riskLevel: "low" },
  { name: "draft_document", category: "draft", riskLevel: "medium" },
  { name: "update_draft", category: "draft", riskLevel: "medium" },
  { name: "render_document", category: "draft", riskLevel: "medium" },
  { name: "render_tracked_draft", category: "draft", riskLevel: "medium" },
  { name: "list_more_tools", category: "system", riskLevel: "low" },
  { name: "read_skill", category: "system", riskLevel: "low" },
  { name: "search_company_registry", category: "search", riskLevel: "low" },
  {
    name: "update_plan",
    category: "system",
    riskLevel: "low",
    parameters: updatePlanTool.definition.parameters,
  },
  { name: "send_email", category: "system", requiresApproval: true, riskLevel: "high" },
  { name: "prepare_outbound_mail", category: "system", riskLevel: "medium" },
  { name: "read_project_file", category: "search", riskLevel: "low" },
  { name: "list_dir", category: "search", riskLevel: "low" },
  { name: "explore_folder", category: "search", riskLevel: "low" },
  { name: "apply_surgical_edits", category: "draft", riskLevel: "medium" },
  { name: "list_mail_inbox", category: "system", riskLevel: "low" },
  { name: "request_approval", category: "system", riskLevel: "low" },
  { name: "research_task", category: "search", riskLevel: "low" },
  { name: "search_statute", category: "search", riskLevel: "low" },
  { name: "search_case_law", category: "search", riskLevel: "low" },
  { name: "calculate", category: "analyze", riskLevel: "low" },
];

export type GateSpyRegistry = {
  registry: ToolRegistry;
  log: GateSpyLog;
  setExecute: (name: string, execute: AgentTool["execute"]) => void;
};

function defaultResult(name: string): ToolCallResult {
  return { ok: true, data: { spy: true, name } };
}

export function createGateSpyRegistry(extra: SpySpec[] = []): GateSpyRegistry {
  const registry = new ToolRegistry();
  const executes = new Map<string, AgentTool["execute"]>();
  const calls: SpyToolCall[] = [];
  const log: GateSpyLog = {
    calls,
    executedNames: () => calls.map((c) => c.name),
  };

  const specs = [...SPY_SPECS, ...extra];
  for (const spec of specs) {
    executes.set(
      spec.name,
      spec.name === "update_plan"
        ? (args, ctx) => updatePlanTool.execute(args, ctx)
        : spec.name === "explore_folder"
          ? (args, ctx) => exploreFolderTool.execute(args, ctx)
          : async () => defaultResult(spec.name),
    );
    registry.register({
      definition: {
        name: spec.name,
        description:
          spec.name === "update_plan"
            ? updatePlanTool.definition.description
            : spec.name === "explore_folder"
              ? exploreFolderTool.definition.description
              : spec.name,
        category: spec.category,
        parameters:
          spec.name === "explore_folder"
            ? exploreFolderTool.definition.parameters
            : (spec.parameters ?? {}),
        requiresApproval: spec.requiresApproval,
        riskLevel: spec.riskLevel,
        isConcurrencySafe:
          spec.name === "update_plan" ? false : spec.name === "explore_folder" ? true : undefined,
      },
      execute: async (args, ctx) => {
        const run = executes.get(spec.name);
        const result = run ? await run(args, ctx) : defaultResult(spec.name);
        calls.push({ name: spec.name, args, result });
        return result;
      },
    });
  }

  return {
    registry,
    log,
    setExecute: (name, execute) => {
      executes.set(name, execute);
    },
  };
}
