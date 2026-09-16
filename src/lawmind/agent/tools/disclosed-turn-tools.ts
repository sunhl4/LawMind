/**
 * Extra tool names disclosed for this turn (xlsx pins, enabled skills, MCP).
 * Same channel as list_more_tools — does not grow CORE_MODEL_TOOL_NAMES.
 */

import { compileIntent } from "../../intent/compile-intent.js";
import type { CompileIntentInput } from "../../intent/types.js";
import { compiledIntentInjectsSkillBodies } from "../../intent/understand-first.js";
import type { ComposeContextPin } from "../../platform/compose-context-pin.js";
import { COMPUTE_INTENT_RE, isPublicWebFactLookup } from "../../skills/capability-patterns.js";
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

export function pinsIncludeWord(pins: ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some((pin) => {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      return false;
    }
    return /\.docx?$/i.test(pin.relPath);
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

/** Extra tools for a bound 办件 — mail/word still get job tools; playbook only denies mis-send/rebuild. */
const CAPABILITY_EXTRA_TOOLS: Record<string, readonly string[]> = {
  "contract.review": ["search_case_law", "calculate", "compare_documents", "search_workspace"],
  "letter.draft": ["search_case_law", "calculate", "compare_documents", "search_workspace"],
  "mail.contract": ["search_case_law", "calculate", "compare_documents", "search_workspace"],
  "labor.calc": ["calculate", "run_compute"],
  "period.calc": ["calculate"],
  "research.memo": [
    "search_case_law",
    "search_workspace",
    "compare_documents",
    "search_statute_web",
  ],
  "analysis.quick": ["search_case_law", "run_compute"],
  "litigation.draft": ["search_case_law", "calculate", "search_workspace", "compare_documents"],
  "litigation.talk": ["search_case_law"],
  "ops.invoice": ["calculate", "analyze_spreadsheet", "run_compute"],
  "ops.court_sms": ["calculate"],
  "ip.dispute": ["search_case_law", "search_workspace", "compare_documents"],
  "deal.ma": ["search_case_law", "search_workspace", "compare_documents"],
  "compliance.data": ["search_case_law", "search_workspace"],
  "compliance.ads": ["search_case_law", "search_workspace"],
  "matter.status": ["calculate", "search_workspace"],
  "family.matter": ["search_case_law", "calculate", "search_workspace", "compare_documents"],
  "capital.markets": ["search_case_law"],
  "corp.governance": ["search_case_law"],
  "materials.draft": ["search_workspace", "compare_documents"],
  "contract.draft": ["search_case_law", "search_workspace", "compare_documents"],
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
  const compiled = compileIntent({ instruction: text, ...extras });
  const extrasTools = [
    ...(compiled.capabilityId ? (CAPABILITY_EXTRA_TOOLS[compiled.capabilityId] ?? []) : []),
  ];
  const hardBind = compiledIntentInjectsSkillBodies(compiled);
  if (
    hardBind &&
    compiled.capabilityId &&
    compiled.capabilityId !== "analysis.quick" &&
    compiled.capabilityId !== "labor.calc" &&
    compiled.capabilityId !== "period.calc"
  ) {
    extrasTools.push("draft_document");
  }
  if (
    hardBind &&
    (compiled.pipelineOverride === "tracked_redline" ||
      compiled.capabilityId === "mail.contract" ||
      (compiled.capabilityId === "contract.review" && pinsIncludeWord(extras?.pins)))
  ) {
    extrasTools.push("render_tracked_draft");
  }
  const filePins = (extras?.pins ?? []).filter(
    (pin) => pin.pinKind === "file" && pin.kind === "file",
  );
  if (filePins.length >= 2) {
    extrasTools.push("compare_documents");
  }
  if (COMPUTE_INTENT_RE.test(text)) {
    extrasTools.push(...COMPUTE_DELIVERABLE_TOOL_NAMES);
  }
  if (/\bhttps?:\/\//i.test(text)) {
    extrasTools.push("url_dossier");
  }
  if (/公开网页|联网查|网上查|搜索网页|用网页查/.test(text)) {
    extrasTools.push("web_search", "search_statute_web");
  }
  if (/深度检索|全面检索|长时调研/.test(text) && !isPublicWebFactLookup(text)) {
    extrasTools.push("deep_research");
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
  found.push("explore_folder");
  found.push("search_workspace");
  found.push("list_mail_inbox");
  found.push("search_conversations", "read_conversation");
  found.push("read_skill", "search_company_registry");
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
  // MCP stays on list_more_tools unless this session already disclosed one.
  const hidden = new Set(
    [...(opts.hiddenNames ?? [])].map((n) => n.trim()).filter((n) => n.length > 0),
  );
  return [...new Set(found.map((n) => n.trim()).filter((n) => n.length > 0 && !hidden.has(n)))];
}
