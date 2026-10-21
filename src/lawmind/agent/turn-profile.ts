/**
 * Turn profiles — the domain control plane for the model/tool loop.
 *
 * Before this module the loop asked deliverable-shape questions inline
 * (`instructionFramesPleading`, `instructionFramesMemoDeliverable`,
 * `instructionFramesConsultQuestions`, `wordRevisionTurn`, …). That meant every
 * new legal deliverable shape edited the loop body.
 *
 * A profile is resolved **once per turn** and answers:
 *   - which coaches (nudges) are available;
 *   - whether the turn must land a tracked-changes Word file;
 *   - whether search is withheld after the write-synthesis coach.
 *
 * The loop only iterates `profile.coaches`; adding a deliverable shape means
 * adding a profile + a cassette, not touching the loop.
 */

import {
  instructionFramesConsultQuestions,
  instructionFramesMemoDeliverable,
  instructionFramesPleading,
} from "./deliverable-shape.js";

export type TurnProfileId =
  | "word_revision"
  | "mail_contract"
  | "pleading"
  | "memo"
  | "consult"
  | "contract_review"
  | "general";

/** Coaches are ordered by the loop; a profile only declares membership. */ export type TurnCoachId =
  | "write_synthesis"
  | "pleading_sections"
  | "consult_questions"
  | "memo_sections"
  | "calculate_params"
  | "forbidden_shell"
  | "identical_repeat"
  | "missing_deliverables"
  | "review_board_export"
  | "steer";

export type TurnProfile = {
  id: TurnProfileId;
  coaches: ReadonlySet<TurnCoachId>;
  /** Hard requirement: this turn must export a tracked-changes Word file. */
  requiresTrackedDraft: boolean;
  /** After the write-synthesis coach fires, search tools stay withheld. */
  locksSearchAfterSynthesis: boolean;
};

/**
 * 带修订的 Word 交付物可以由两条路产生：
 * - `render_tracked_draft`：在原件副本上叠加内容修订；
 * - `fix_document_format`：把格式统一写成 Word 格式修订的副本。
 *
 * 只认前者会把「律师只要求统一格式」的回合逼进内容改稿链，最后撞上
 * 「没有待叠修订不得导出」的闸门。两者都算这一轮把带痕迹的稿子写出来了。
 */
export const TRACKED_ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "render_tracked_draft",
  "fix_document_format",
]);

/**
 * 工具**真的写出了文件**才算交付：`ok` 加非空 `outputPath`。
 *
 * 只数调用次数会把「调用但失败」「没有可改的段落所以没写副本」也算成已交付，
 * 模型就能在什么都没写的情况下正常收工。
 */
export function toolResultWroteTrackedArtifact(
  toolName: string,
  result: { ok: boolean; data?: unknown },
): boolean {
  if (!result.ok || !TRACKED_ARTIFACT_TOOL_NAMES.has(toolName)) {
    return false;
  }
  const data = result.data;
  if (!data || typeof data !== "object") {
    return false;
  }
  const outputPath = (data as { outputPath?: unknown }).outputPath;
  return typeof outputPath === "string" && outputPath.trim().length > 0;
}

export function hasTrackedWordArtifact(turn: { trackedArtifactWritten?: boolean }): boolean {
  return turn.trackedArtifactWritten === true;
}

/** Coaches every turn shares. */
const BASE_COACHES: readonly TurnCoachId[] = [
  "write_synthesis",
  "calculate_params",
  "forbidden_shell",
  "identical_repeat",
  "missing_deliverables",
  "review_board_export",
  "steer",
];

const WORD_REVISION_COACHES: readonly TurnCoachId[] = [...BASE_COACHES];

export type ResolveTurnProfileInput = {
  instruction: string;
  wordRevision: boolean;
  mailContract: boolean;
  capabilityId?: string;
};

/**
 * Resolve the profile from the *same* signals the loop used before, so this is
 * a pure relocation of domain knowledge — not a behavior change.
 */
export function resolveTurnProfile(input: ResolveTurnProfileInput): TurnProfile {
  const framesPleading = instructionFramesPleading(input.instruction);
  const framesMemo = instructionFramesMemoDeliverable(input.instruction);
  const framesConsult = instructionFramesConsultQuestions(input.instruction);

  let id: TurnProfileId = "general";
  const coaches = new Set<TurnCoachId>();

  if (input.wordRevision) {
    id = "word_revision";
    for (const coach of WORD_REVISION_COACHES) {
      coaches.add(coach);
    }
    // Word revision keeps the section coaches too: a pleading revision still
    // gets 【诉状要件】. This mirrors the pre-profile loop, which evaluated the
    // frames independently of `wordRevisionTurn`.
    if (framesPleading) {
      coaches.add("pleading_sections");
    }
    if (framesMemo) {
      coaches.add("memo_sections");
    }
    if (framesConsult) {
      coaches.add("consult_questions");
    }
    return {
      id,
      coaches,
      requiresTrackedDraft: true,
      // A Word-revision request can still be a consult-list request ("改这份，
      // 只列追问"). The old loop locked search from `frameConsult` regardless of
      // `wordRevisionTurn`; keep that.
      locksSearchAfterSynthesis: framesConsult,
    };
  }

  for (const coach of BASE_COACHES) {
    coaches.add(coach);
  }
  if (framesPleading) {
    coaches.add("pleading_sections");
  }
  if (framesMemo) {
    coaches.add("memo_sections");
  }
  if (framesConsult) {
    coaches.add("consult_questions");
  }

  if (input.mailContract) {
    id = "mail_contract";
  } else if (framesConsult) {
    id = "consult";
  } else if (framesPleading) {
    id = "pleading";
  } else if (framesMemo) {
    id = "memo";
  } else if (input.capabilityId === "contract.review") {
    id = "contract_review";
  }

  return {
    id,
    coaches,
    requiresTrackedDraft: false,
    // Consult questions are a list, not prose: lock search after the coach so
    // the model cannot slide back into another research loop.
    locksSearchAfterSynthesis: framesConsult,
  };
}
