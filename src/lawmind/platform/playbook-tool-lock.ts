/**
 * High-frequency lawyer playbooks → frozen tool table for this turn.
 * Mail-contract wins over Word revision; Word revision wins over opinion review.
 */

import type { ComposeContextPin } from "./compose-context-pin.js";
import {
  CONTRACT_FAST_LANE_DENIED_HINT,
  contractFastLaneAllowNames,
} from "./contract-fast-lane-instruction.js";
import {
  MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
  mailContractFastPathAllowNames,
} from "./mail-contract-short-path-instruction.js";
import { WORD_REVISION_DENIED_HINT, wordRevisionAllowNames } from "./word-revision-instruction.js";

export type PlaybookToolLockId = "mail-contract" | "word-revision" | "contract-review";

export type PlaybookToolLock = {
  id: PlaybookToolLockId;
  allowNames: string[];
  denyHint: string;
};

export function resolvePlaybookToolLock(
  instruction: string,
  pins?: ComposeContextPin[],
): PlaybookToolLock | undefined {
  const mail = mailContractFastPathAllowNames(instruction);
  if (mail) {
    return {
      id: "mail-contract",
      allowNames: mail,
      denyHint: MAIL_CONTRACT_FAST_PATH_DENIED_HINT,
    };
  }
  const wordRevision = wordRevisionAllowNames(instruction, pins);
  if (wordRevision) {
    return {
      id: "word-revision",
      allowNames: wordRevision,
      denyHint: WORD_REVISION_DENIED_HINT,
    };
  }
  const contract = contractFastLaneAllowNames(instruction);
  if (contract) {
    return {
      id: "contract-review",
      allowNames: contract,
      denyHint: CONTRACT_FAST_LANE_DENIED_HINT,
    };
  }
  return undefined;
}
