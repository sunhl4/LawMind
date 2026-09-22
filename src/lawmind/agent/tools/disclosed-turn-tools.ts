/**
 * Extra tool names disclosed for this turn (xlsx pins, enabled skills, MCP).
 * Same channel as list_more_tools — does not grow CORE_MODEL_TOOL_NAMES.
 */

import { compileIntent } from "../../intent/compile-intent.js";
import { classifyDocumentGenre } from "../../intent/document-genre.js";
import { extractTextIntent } from "../../intent/text-intent.js";
import type { CompileIntentInput } from "../../intent/types.js";
import { compiledIntentInjectsSkillBodies } from "../../intent/understand-first.js";
import { instructionLooksLikeLetterQa } from "../../intent/utterance-kind.js";
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

/** Read case archive when a matter is bound. */
export const DESK_READ_TOOLS = [
  "get_matter_summary",
  "read_case_file",
  "search_matter",
  "list_matters",
] as const;

/** Court SMS / summons → write deadlines. */
export const DESK_EVENTS_TOOLS = [
  "extract_legal_events",
  "apply_legal_events",
  "update_matter_profile",
  "record_deadline",
  "import_host_file",
  "search_host",
  "read_host_file",
  "list_dir",
  "explore_folder",
  "calculate",
] as const;

/** Talk / meeting notes → intake brief. */
export const DESK_TALK_TOOLS = [
  "compile_intake_brief",
  "apply_intake_brief",
  "update_matter_profile",
  "search_case_law",
] as const;

/** Folder / materials intake → host + archive writes. */
export const DESK_INTAKE_TOOLS = [
  "explore_folder",
  "list_dir",
  "read_folder_documents",
  "search_host",
  "read_host_file",
  "import_host_file",
  "update_matter_profile",
  "extract_legal_events",
  "apply_legal_events",
  "compile_intake_brief",
  "apply_intake_brief",
  "add_case_note",
  "propose_organize_plan",
  "execute_organize_plan",
] as const;

/**
 * 案件管理写穿链路：每轮始终广告，不再靠关键词/钉选命中。
 * 律师任何一句「读材料 → 填/更新案件管理」都必须当场可写；
 * 这些工具本身可撤销（revert_desk_write）且不触发待我拍板。
 */
export const DESK_WRITE_ALWAYS_TOOLS = [
  ...DESK_INTAKE_TOOLS,
  "create_matter",
  "revert_desk_write",
  "record_deadline",
] as const;

/** Invoice / spreadsheet ops. */
export const DESK_INVOICE_TOOLS = [
  "calculate",
  "analyze_spreadsheet",
  "run_compute",
  "import_host_file",
  "update_matter_profile",
] as const;

/** Timeline / chronology. */
export const DESK_TIMELINE_TOOLS = [
  "extract_legal_events",
  "apply_legal_events",
  "add_case_note",
  "update_matter_profile",
  "search_workspace",
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

function pinRelPaths(pins: ComposeContextPin[] | undefined): string[] {
  return (pins ?? [])
    .filter((pin): pin is Extract<ComposeContextPin, { pinKind: "file" }> => pin.pinKind === "file")
    .map((pin) => pin.relPath.trim())
    .filter(Boolean);
}

function instructionLooksLikeDeskIntake(text: string): boolean {
  return /补卷宗|按这个文件夹|按里面的材料|整理材料|归位材料|整理案卷|整理一下?(材料|案卷|卷宗)|(材料|案卷|卷宗|materials).{0,4}整理/.test(
    text,
  );
}

function instructionLooksLikeDeskEvents(text: string): boolean {
  return /贴传票|补期限|按传票|写入开庭|补上开庭|抽出开庭/.test(text);
}

function pinsSuggestDeskEvents(pins: ComposeContextPin[] | undefined): boolean {
  return pinRelPaths(pins).some((rel) => classifyDocumentGenre(rel) === "court_notice");
}

function pinsSuggestDeskTalk(pins: ComposeContextPin[] | undefined): boolean {
  return pinRelPaths(pins).some((rel) => classifyDocumentGenre(rel) === "talk");
}

function pinsSuggestIdentityProfile(pins: ComposeContextPin[] | undefined): boolean {
  return pinRelPaths(pins).some((rel) => classifyDocumentGenre(rel) === "identity");
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
  "litigation.talk": [...DESK_TALK_TOOLS],
  "ops.invoice": [...DESK_INVOICE_TOOLS],
  "ops.court_sms": [...DESK_EVENTS_TOOLS],
  "matter.intake": [...DESK_INTAKE_TOOLS],
  "chronology.timeline": [...DESK_TIMELINE_TOOLS],
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
  const draftCapability =
    compiled.capabilityId === "letter.draft" ||
    compiled.capabilityId === "contract.draft" ||
    compiled.capabilityId === "litigation.draft" ||
    compiled.capabilityId === "materials.draft";
  if (
    (draftCapability || extractTextIntent(text).verbs.includes("draft")) &&
    !instructionLooksLikeLetterQa(text)
  ) {
    extrasTools.push("draft_worker");
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
  if (
    instructionLooksLikeDeskEvents(text) ||
    pinsSuggestDeskEvents(extras?.pins) ||
    compiled.capabilityId === "ops.court_sms"
  ) {
    extrasTools.push(...DESK_EVENTS_TOOLS);
  }
  if (pinsSuggestDeskTalk(extras?.pins) || compiled.capabilityId === "litigation.talk") {
    extrasTools.push(...DESK_TALK_TOOLS);
  }
  if (
    instructionLooksLikeDeskIntake(text) ||
    pinsIncludeDirectory(extras?.pins) ||
    compiled.capabilityId === "matter.intake"
  ) {
    extrasTools.push(...DESK_INTAKE_TOOLS);
  }
  if (pinsSuggestIdentityProfile(extras?.pins)) {
    extrasTools.push("update_matter_profile", "analyze_document", "import_host_file");
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
  /** Bound matter → disclose desk.read. */
  matterId?: string;
}): string[] {
  const found = collectDisclosedToolNames(opts.session);
  found.push("run_compute");
  found.push("list_dir");
  found.push("explore_folder");
  found.push("search_workspace");
  found.push("list_mail_inbox");
  found.push("search_conversations", "read_conversation");
  found.push("read_skill", "search_company_registry");
  found.push(...DESK_WRITE_ALWAYS_TOOLS);
  if (opts.matterId?.trim()) {
    found.push(...DESK_READ_TOOLS);
  }
  if (pinsIncludeXlsx(opts.pins)) {
    found.push(...PINNED_SPREADSHEET_TOOL_NAMES);
  }
  if (pinsIncludeDirectory(opts.pins) || Boolean(opts.projectDir?.trim())) {
    found.push("search_host", "read_host_file", "list_dir");
  }
  if (pinsIncludeDirectory(opts.pins) || instructionLooksLikeDeskIntake(opts.instruction ?? "")) {
    found.push(...DESK_INTAKE_TOOLS);
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
