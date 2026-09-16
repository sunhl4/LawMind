/**
 * High-frequency lawyer playbooks → deny-list only (mis-send / template rebuild).
 * Mail-contract wins over Word revision. Read-first (folder / 函件核对 / 看看)
 * denies mutate-source tools so understanding is not skipped. 5-minute review
 * is prompt coaching only.
 */

import { instructionLooksLikeLetterQa, isReadFirstUtterance } from "../intent/utterance-kind.js";
import type { ComposeContextPin } from "./compose-context-pin.js";
import {
  isMailContractFastPathInstruction,
  MAIL_CONTRACT_DENY_TOOL_NAMES,
  MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
} from "./mail-contract-short-path-instruction.js";
import {
  isWordRevisionTurn,
  WORD_REVISION_DENIED_HINT,
  WORD_REVISION_DENY_TOOL_NAMES,
} from "./word-revision-instruction.js";

export type PlaybookToolLockId = "mail-contract" | "word-revision" | "read-first";

export type PlaybookToolLock = {
  id: PlaybookToolLockId;
  denyNames: string[];
  denyHint: string;
};

export const READ_FIRST_DENY_TOOL_NAMES = [
  "apply_surgical_edits",
  "render_tracked_draft",
  "prepare_outbound_mail",
] as const;

export const READ_FIRST_LETTER_QA_DENY_TOOL_NAMES = [
  ...READ_FIRST_DENY_TOOL_NAMES,
  "draft_document",
  "update_draft",
  "render_document",
] as const;

export const READ_FIRST_DENIED_HINT =
  "本轮先读材料、指出对错。未读完前不要改原件、不要出审阅痕迹、不要准备外发。";

export const READ_FIRST_LETTER_QA_DENIED_HINT =
  "本轮交付是会话里的核对意见。先读文件夹/函件，逐点对错并引用出处；不要另起一封律师函 Word，不要出审阅痕迹。";

function pinsHaveDirectory(pins: ComposeContextPin[] | undefined): boolean {
  return (pins ?? []).some((pin) => pin.pinKind === "file" && pin.kind === "directory");
}

export function resolvePlaybookToolLock(
  instruction: string,
  pins?: ComposeContextPin[],
): PlaybookToolLock | undefined {
  if (isMailContractFastPathInstruction(instruction)) {
    return {
      id: "mail-contract",
      denyNames: [...MAIL_CONTRACT_DENY_TOOL_NAMES],
      denyHint: MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
    };
  }
  if (isWordRevisionTurn({ instruction, pins })) {
    return {
      id: "word-revision",
      denyNames: [...WORD_REVISION_DENY_TOOL_NAMES],
      denyHint: WORD_REVISION_DENIED_HINT,
    };
  }
  if (isReadFirstUtterance(instruction) || pinsHaveDirectory(pins)) {
    const letterQa = instructionLooksLikeLetterQa(instruction);
    return {
      id: "read-first",
      denyNames: letterQa
        ? [...READ_FIRST_LETTER_QA_DENY_TOOL_NAMES]
        : [...READ_FIRST_DENY_TOOL_NAMES],
      denyHint: letterQa ? READ_FIRST_LETTER_QA_DENIED_HINT : READ_FIRST_DENIED_HINT,
    };
  }
  return undefined;
}
