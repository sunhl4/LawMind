/**
 * Codex-style turn order: understand the latest utterance before caging the
 * model with a keyword-bound Skill dump. Hard binds (lock / mail / Word 改稿 /
 * specialized / high-confidence joint with an explicit action) still inject
 * lean Skill bodies. Look-only lines and sticky 继续 stay hypotheses.
 */

import { deskItemById } from "../skills/lawyer-capability-lock.js";
import type { CompiledIntent } from "./types.js";

export const UNDERSTAND_FIRST_HEADING = "## 本轮理解";
export const INTENT_HYPOTHESIS_HEADING = "## 本轮初步判断";

const HARD_SOURCES = new Set<CompiledIntent["source"]>(["lock", "short_path", "word_revision"]);

/** True when this bind may dump Skill bodies and playbooks into the prompt. */
export function compiledIntentInjectsSkillBodies(compiled: CompiledIntent): boolean {
  if (!compiled.capabilityId) {
    return false;
  }
  if (compiled.pipelineOverride === "tracked_redline") {
    return true;
  }
  if (HARD_SOURCES.has(compiled.source)) {
    return true;
  }
  if (compiled.source === "specialized") {
    return compiled.confidence === "high";
  }
  return compiled.source === "joint" && compiled.confidence === "high";
}

export function formatUnderstandFirstPromptBlock(): string {
  return [
    UNDERSTAND_FIRST_HEADING,
    "律师最新一条原话是本轮任务定义，原样保留，不要改写成另一句 hidden prompt。",
    "先判断要做什么、明确不要做什么、材料在哪，再调用工具。",
    "系统给出的能力绑定或上轮清单只是启发式；与原话冲突时以原话为准（律师用 `$skill` / `【办件】` 指定、邮件短路径、文件页「改这份 Word」除外）。",
    "提到文件夹时先 `explore_folder`（写入 goal / not_goal / path）看清树再阅读文件，不要未读材料就 `apply_surgical_edits` / `render_tracked_draft`。",
    "若律师要的是把文件或文件夹收进案件，直接 `import_host_file`（相对路径即可，案件可用展示名），不要先通读。",
  ].join("\n");
}

export function formatIntentHypothesisBlock(compiled: CompiledIntent): string {
  if (!compiled.capabilityId) {
    return "";
  }
  const label = deskItemById(compiled.capabilityId)?.label ?? compiled.capabilityId;
  const summary = compiled.lawyerSummary?.trim();
  return [
    INTENT_HYPOTHESIS_HEADING,
    `${summary || label}（\`${compiled.capabilityId}\`）。这是启发式，以律师本轮原话为准。需要某份技能时调用 \`read_skill\`。`,
  ].join("\n");
}
