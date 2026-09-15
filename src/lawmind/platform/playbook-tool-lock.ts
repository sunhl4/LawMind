/**
 * High-frequency lawyer playbooks → deny-list only (mis-send / template rebuild).
 * Mail-contract wins over Word revision. 5-minute review is prompt coaching only.
 */

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

export type PlaybookToolLockId = "mail-contract" | "word-revision";

export type PlaybookToolLock = {
  id: PlaybookToolLockId;
  denyNames: string[];
  denyHint: string;
};

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
  return undefined;
}
