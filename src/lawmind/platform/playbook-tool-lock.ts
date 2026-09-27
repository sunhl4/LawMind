/**
 * High-frequency lawyer playbooks → deny-list only.
 * Mail-contract wins over Word revision.
 * Hard deny is mis-send, template rebuild, look-only outbound mail,
 * and letter-QA (do not draft a replacement letter).
 * Look-only keeps edit tools; read-then-revise is prompt coaching plus approval.
 * A folder mention or directory pin does not remove edit tools: the model
 * can read and revise in the same turn. 5-minute review is prompt coaching only.
 */

import { instructionLooksLikeLetterQa, isLookOnlyUtterance } from "../intent/utterance-kind.js";
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

/** Letter-QA mutate set. Look-only does not use this list. */
export const READ_FIRST_DENY_TOOL_NAMES = [
  "apply_surgical_edits",
  "render_tracked_draft",
  "prepare_outbound_mail",
] as const;

/** Bare 「帮我看看」: block irreversible outbound only. */
export const LOOK_ONLY_DENY_TOOL_NAMES = ["prepare_outbound_mail"] as const;

export const READ_FIRST_LETTER_QA_DENY_TOOL_NAMES = [
  ...READ_FIRST_DENY_TOOL_NAMES,
  "draft_document",
  "update_draft",
  "render_document",
  "draft_worker",
] as const;

export const LOOK_ONLY_DENIED_HINT =
  "本轮原话是先看材料。外发要律师另说要发。改稿可以在读完后做，改原件仍须律师确认。";

export const READ_FIRST_LETTER_QA_DENIED_HINT =
  "本轮交付是会话里的核对意见。先读文件夹/函件，逐点对错并引用出处；不要另起一封律师函 Word，不要出审阅痕迹。";

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
  // Explicit contrary deliverable only. Folder language and a directory pin
  // stay available so the model can read and then revise in the same turn.
  if (instructionLooksLikeLetterQa(instruction)) {
    return {
      id: "read-first",
      denyNames: [...READ_FIRST_LETTER_QA_DENY_TOOL_NAMES],
      denyHint: READ_FIRST_LETTER_QA_DENIED_HINT,
    };
  }
  if (isLookOnlyUtterance(instruction)) {
    return {
      id: "read-first",
      denyNames: [...LOOK_ONLY_DENY_TOOL_NAMES],
      denyHint: LOOK_ONLY_DENIED_HINT,
    };
  }
  return undefined;
}
