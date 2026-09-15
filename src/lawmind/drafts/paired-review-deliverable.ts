/**
 * Unlocked 合同审查 with a pinned Word: default both opinion and tracked redline.
 * Coaching, not a frozen tool sequence. Mail / file-page Word locks unchanged.
 */

import {
  isOpinionOnlyFastLane,
  SURGICAL_PROTOCOL_TOOLS,
  toolsAllowAny,
  type PromptProtocolGate,
} from "../agent/prompt-protocol-gate.js";
import { isOpinionMemoDelivery, resolveTurnDeliveryIntent } from "../intent/delivery-intent.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";

export function wordFilePinRelPaths(pins: ComposeContextPin[] | undefined): string[] {
  const out: string[] = [];
  for (const pin of pins ?? []) {
    if (pin.pinKind !== "file" || pin.kind !== "file") {
      continue;
    }
    if (/\.docx?$/i.test(pin.relPath)) {
      out.push(pin.relPath);
    }
  }
  return out;
}

export function pinsIncludeWordFile(pins: ComposeContextPin[] | undefined): boolean {
  return wordFilePinRelPaths(pins).length > 0;
}

export function shouldInjectPairedReviewDeliverable(
  bound: { id: string; pipeline: string } | null | undefined,
  pins: ComposeContextPin[] | undefined,
  gate?: PromptProtocolGate,
): boolean {
  if (!bound || bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return false;
  }
  if (isOpinionOnlyFastLane(gate?.instruction) && !pinsIncludeWordFile(pins ?? gate?.pins)) {
    return false;
  }
  if (isOpinionMemoDelivery(resolveTurnDeliveryIntent(gate?.instruction, pins ?? gate?.pins))) {
    return false;
  }
  if (!toolsAllowAny(gate?.availableToolNames, SURGICAL_PROTOCOL_TOOLS)) {
    return false;
  }
  return bound.id === "contract.review" && pinsIncludeWordFile(pins);
}

export function formatPairedReviewDeliverablePromptBlock(): string {
  return [
    "## 成套交件",
    "本回合钉选了 Word：默认交审查意见（宏观/中观/微观 + 推荐措辞）以及一份审阅痕迹修订稿（`render_tracked_draft`）。",
    "`draft_document` 先出意见并打上原合同基线；`apply_surgical_edits` 会把意见快照下来，再对合同正文落改。不要用 `update_draft` 把意见章节整节换成合同。",
    "律师只要其中一种交件时按指定。工具表不收窄。空修订不得导出。原 Word / 邮件短路径不走本条。",
  ].join("\n");
}
