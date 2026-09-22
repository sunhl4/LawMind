/**
 * Utterance-grounded working brief (Codex update_plan analogue).
 * Restates the latest lawyer line; does not bind a capability pipeline.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { extractTextIntent } from "./text-intent.js";
import {
  instructionLooksLikeLetterQa,
  instructionAsksToFileIntoMatter,
  instructionMentionsFolder,
  namedBracketFolders,
  stripRejectedContractReviewPhrases,
} from "./utterance-kind.js";

export const WORKING_BRIEF_HEADING = "## 本轮工作任务书";

export type WorkingBriefHints = {
  goal: string;
  notGoal: string;
  materials: string;
  done: string;
};

const FIELD_MAX = 80;

function clip(raw: string, max = FIELD_MAX): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max).trimEnd()}…`;
}

function namedFolders(instruction: string): string[] {
  return namedBracketFolders(instruction);
}

function pinsHaveDirectory(pins: ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some((pin) => pin.pinKind === "file" && pin.kind === "directory");
}

function pinFileNames(pins: ComposeContextPin[] | undefined): string[] {
  const out: string[] = [];
  for (const pin of pins ?? []) {
    if (pin.pinKind === "file" && pin.kind === "file" && pin.relPath.trim()) {
      out.push(pin.relPath.trim());
    }
  }
  return out;
}

export function extractWorkingBriefHints(input: {
  instruction: string;
  pins?: ComposeContextPin[];
}): WorkingBriefHints {
  const instruction = input.instruction.trim();
  const stripped = stripRejectedContractReviewPhrases(instruction).replace(/\s+/g, " ").trim();
  const text = extractTextIntent(instruction);
  const goal = clip(stripped || instruction);

  const notParts: string[] = [];
  if (text.rejectsContractReview) {
    notParts.push("合同审查", "审阅痕迹稿", "未读材料就改稿");
  }
  const notGoal = clip(notParts.join("；") || "以律师原话里的否定为准；未排除的不要自行缩小范围");

  const mat: string[] = [];
  const folders = namedFolders(instruction);
  const folderTalk = instructionMentionsFolder(instruction) || pinsHaveDirectory(input.pins);
  if (instructionAsksToFileIntoMatter(instruction)) {
    mat.push("用 import_host_file 收进律师点名的案件；按原话路径，不要先通读");
  } else if (folderTalk) {
    mat.push(
      folders.length > 0
        ? `${folders.join("、")}：先 explore_folder`
        : "先 explore_folder / list_dir 看清树",
    );
  }
  for (const rel of pinFileNames(input.pins)) {
    mat.push(rel);
  }
  const materials = clip(mat.join("；") || "以原话与钉选为准");

  const done = clip(
    instructionLooksLikeLetterQa(instruction)
      ? "在会话给出核对意见（对错、出处、建议改法）；不要另起一封律师函或红线稿"
      : /有误|核对/.test(instruction)
        ? "对照材料指出具体对错并引用出处；未读材料不得改稿或声称已完成"
        : "按原话交付；未读材料不得改稿",
  );

  return { goal, notGoal, materials, done };
}

export function formatWorkingBriefPromptBlock(hints: WorkingBriefHints): string {
  return [
    WORKING_BRIEF_HEADING,
    "这是对律师原话的工作理解，不是替换原话。先用 `update_plan` 把四行定稿（可改），再动重工具。",
    `- 要做：${hints.goal}`,
    `- 不要做：${hints.notGoal}`,
    `- 材料：${hints.materials}`,
    `- 完成标准：${hints.done}`,
    "提到文件夹时先 `explore_folder`（任务书写进 goal / not_goal / path），不要未读就 `apply_surgical_edits`。",
  ].join("\n");
}
