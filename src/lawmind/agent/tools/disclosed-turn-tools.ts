/**
 * Extra tool names disclosed for this turn (xlsx pins, enabled skills, MCP).
 * Same channel as list_more_tools — does not grow CORE_MODEL_TOOL_NAMES.
 */

import type { CompileIntentInput } from "../../intent/types.js";
import type { ComposeContextPin } from "../../platform/compose-context-pin.js";
import { COMPUTE_INTENT_RE, isPublicWebFactLookup } from "../../skills/capability-patterns.js";
import { bindLawyerCapability } from "../../skills/lawyer-capabilities.js";
import { listLocalSkills } from "../../skills/skill-runtime.js";
import { collectDisclosedToolNames } from "./governance.js";
import type { ToolRegistry } from "./registry.js";

export const PINNED_SPREADSHEET_TOOL_NAMES = [
  "analyze_spreadsheet",
  "write_spreadsheet",
  "render_chart",
  "calculate",
  "run_compute",
] as const;

export const COMPUTE_DELIVERABLE_TOOL_NAMES = [
  "run_compute",
  "render_chart",
  "write_spreadsheet",
  "analyze_spreadsheet",
  "calculate",
] as const;

export function pinsIncludeDirectory(pins: ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some((pin) => pin.pinKind === "file" && pin.kind === "directory");
}

export function pinsIncludeXlsx(pins: ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some((pin) => {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      return false;
    }
    return /\.xlsx$/i.test(pin.relPath);
  });
}

/** Skills must not auto-disclose outbound / 改稿 / 流程工具。 */
const SKILL_DISCLOSE_DENY = new Set([
  "send_email",
  "prepare_outbound_mail",
  "write_document",
  "render_document",
  "render_tracked_draft",
  "apply_surgical_edits",
  "draft_document",
  "update_draft",
  "execute_workflow",
  "request_approval",
  "delegate_task",
  "delegate_to_role",
]);

export function collectEnabledSkillToolNames(workspaceDir: string): string[] {
  try {
    return listLocalSkills(workspaceDir)
      .filter((s) => s.enabled && s.signatureOk)
      .flatMap((s) => s.toolNames ?? [])
      .filter((name) => !SKILL_DISCLOSE_DENY.has(name));
  } catch {
    return [];
  }
}

/** Extra tools for a bound 办件 — never used on mail/word locks (those freeze allowNames). */
const CAPABILITY_EXTRA_TOOLS: Record<string, readonly string[]> = {
  "contract.review": ["search_case_law"],
  "labor.calc": ["calculate", "run_compute"],
  "period.calc": ["calculate"],
  "research.memo": ["search_case_law"],
  "analysis.quick": ["search_case_law", "run_compute"],
  "litigation.draft": ["search_case_law", "calculate"],
  "litigation.talk": ["search_case_law"],
  "ops.invoice": ["calculate", "analyze_spreadsheet", "run_compute"],
  "ops.court_sms": ["calculate"],
  "ip.dispute": ["search_case_law"],
  "deal.ma": ["search_case_law"],
  "compliance.data": ["search_case_law"],
  "compliance.ads": ["search_case_law"],
  "matter.status": ["calculate"],
  "family.matter": ["search_case_law", "calculate"],
  "capital.markets": ["search_case_law"],
  "corp.governance": ["search_case_law"],
};

export function extraToolsForInstruction(
  instruction: string | undefined,
  extras?: Pick<CompileIntentInput, "pins" | "documents" | "matterKind" | "previousCapabilityId">,
): string[] {
  const text = instruction?.trim() ?? "";
  const hasMaterials = (extras?.pins?.length ?? 0) > 0 || (extras?.documents?.length ?? 0) > 0;
  if (text.length < 4 && !hasMaterials) {
    return [];
  }
  if (isPublicWebFactLookup(text)) {
    return ["web_search"];
  }
  const bound = bindLawyerCapability({ instruction: text, ...extras });
  if (bound?.pipeline === "tracked_redline" || bound?.id === "mail.contract") {
    return [];
  }
  const extrasTools = [...(bound ? (CAPABILITY_EXTRA_TOOLS[bound.id] ?? []) : [])];
  if (COMPUTE_INTENT_RE.test(text)) {
    extrasTools.push(...COMPUTE_DELIVERABLE_TOOL_NAMES);
  }
  return [...new Set(extrasTools)];
}

export function collectRegisteredMcpToolNames(registry: ToolRegistry): string[] {
  return registry
    .listDefinitions()
    .map((d) => d.name)
    .filter((name) => name.startsWith("mcp__"));
}

export function mergeTurnDisclosedToolNames(opts: {
  session: {
    disclosedToolNames?: string[];
    conversationHistory?: Array<{
      toolCallResponses?: Array<{ name?: string; result?: { data?: unknown } }>;
    }>;
  };
  workspaceDir: string;
  pins?: ComposeContextPin[];
  registry?: ToolRegistry;
  hiddenNames?: Iterable<string>;
  instruction?: string;
  projectDir?: string;
  documents?: import("../../intent/types.js").DocumentPeek[];
  matterKind?: "contract" | "litigation" | "general";
  previousCapabilityId?: import("../../skills/lawyer-capability-lock.js").LawyerCapabilityId;
}): string[] {
  const found = collectDisclosedToolNames(opts.session);
  found.push("run_compute");
  found.push("list_dir");
  // Public web search is registered only when the turn allows it; disclosing here
  // makes the model actually able to call it without list_more_tools first.
  found.push("web_search", "search_statute_web", "url_dossier");
  if (!isPublicWebFactLookup(opts.instruction ?? "")) {
    found.push("deep_research");
  }
  if (pinsIncludeXlsx(opts.pins)) {
    found.push(...PINNED_SPREADSHEET_TOOL_NAMES);
  }
  if (pinsIncludeDirectory(opts.pins) || Boolean(opts.projectDir?.trim())) {
    found.push("search_host", "read_host_file", "list_dir");
  }
  found.push(...collectEnabledSkillToolNames(opts.workspaceDir));
  found.push(
    ...extraToolsForInstruction(opts.instruction, {
      pins: opts.pins,
      documents: opts.documents,
      matterKind: opts.matterKind,
      previousCapabilityId: opts.previousCapabilityId,
    }),
  );
  if (opts.registry) {
    found.push(...collectRegisteredMcpToolNames(opts.registry));
  }
  const hidden = new Set(
    [...(opts.hiddenNames ?? [])].map((n) => n.trim()).filter((n) => n.length > 0),
  );
  return [...new Set(found.map((n) => n.trim()).filter((n) => n.length > 0 && !hidden.has(n)))];
}
