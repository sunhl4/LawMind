/**
 * Extra tool names disclosed for this turn (xlsx pins, enabled skills, MCP).
 * Same channel as list_more_tools — does not grow CORE_MODEL_TOOL_NAMES.
 */

import type { ComposeContextPin } from "../../platform/compose-context-pin.js";
import { bindLawyerCapability } from "../../skills/lawyer-capabilities.js";
import { listLocalSkills } from "../../skills/skill-runtime.js";
import { collectDisclosedToolNames } from "./governance.js";
import type { ToolRegistry } from "./registry.js";

export const PINNED_SPREADSHEET_TOOL_NAMES = [
  "analyze_spreadsheet",
  "write_spreadsheet",
  "render_chart",
  "calculate",
] as const;

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
  "labor.calc": ["calculate"],
  "period.calc": ["calculate"],
  "research.memo": ["search_case_law"],
  "analysis.quick": ["search_case_law"],
  "litigation.draft": ["search_case_law", "calculate"],
  "litigation.talk": ["search_case_law"],
  "ops.invoice": ["calculate", "analyze_spreadsheet"],
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

export function extraToolsForInstruction(instruction: string | undefined): string[] {
  const text = instruction?.trim() ?? "";
  if (text.length < 4) {
    return [];
  }
  const bound = bindLawyerCapability({ instruction: text });
  if (!bound || bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return [];
  }
  return [...(CAPABILITY_EXTRA_TOOLS[bound.id] ?? [])];
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
}): string[] {
  const found = collectDisclosedToolNames(opts.session);
  if (pinsIncludeXlsx(opts.pins)) {
    found.push(...PINNED_SPREADSHEET_TOOL_NAMES);
  }
  found.push(...collectEnabledSkillToolNames(opts.workspaceDir));
  found.push(...extraToolsForInstruction(opts.instruction));
  if (opts.registry) {
    found.push(...collectRegisteredMcpToolNames(opts.registry));
  }
  const hidden = new Set(
    [...(opts.hiddenNames ?? [])].map((n) => n.trim()).filter((n) => n.length > 0),
  );
  return [...new Set(found.map((n) => n.trim()).filter((n) => n.length > 0 && !hidden.has(n)))];
}
