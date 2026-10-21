/**
 * One mechanical deliverable verdict for every write path.
 * Signals the caller did not apply stay out of the verdict (null), so a
 * file-only save is not treated as "green" just because no gate ran.
 */

import type { DraftCitationIntegrityView } from "./citation-integrity.js";

export type MechanicalBlock =
  | "citation"
  | "acceptance"
  | "empty_redline"
  /** 引用的来源在引用之后被改过（`evidence-support` 判定 stale）。 */
  | "citation_stale"
  /** 引用了来源，但记录的原文在文件里找不到。 */
  | "citation_quote_mismatch";

export type MechanicalSignals = {
  /** null = citation gate not in force for this call. */
  citation: DraftCitationIntegrityView | null;
  /** null = acceptance gate not in force. false = spec not ready. */
  acceptanceReady: boolean | null;
  /**
   * null = this call is not a tracked-redline export.
   * 0 = empty redline, which blocks export.
   */
  redlinePending: number | null;
};

export type MechanicalVerdict = {
  /** True only when at least one signal was applied and none blocked. */
  green: boolean;
  blocks: MechanicalBlock[];
};

export function citationViewBlocksExport(view: DraftCitationIntegrityView): boolean {
  if (!view.checked) {
    return false;
  }
  return (
    !view.ok ||
    view.unanchoredSections.length > 0 ||
    (view.staleSources?.length ?? 0) > 0 ||
    (view.quoteMismatches?.length ?? 0) > 0
  );
}

export function evaluateMechanicalVerdict(signals: MechanicalSignals): MechanicalVerdict {
  const blocks: MechanicalBlock[] = [];
  let applied = false;
  if (signals.citation?.checked) {
    applied = true;
    const view = signals.citation;
    if (!view.ok || view.unanchoredSections.length > 0) {
      blocks.push("citation");
    }
    if ((view.staleSources?.length ?? 0) > 0) {
      blocks.push("citation_stale");
    }
    if ((view.quoteMismatches?.length ?? 0) > 0) {
      blocks.push("citation_quote_mismatch");
    }
  }
  if (signals.acceptanceReady != null) {
    applied = true;
    if (!signals.acceptanceReady) {
      blocks.push("acceptance");
    }
  }
  if (signals.redlinePending != null) {
    applied = true;
    if (signals.redlinePending === 0) {
      blocks.push("empty_redline");
    }
  }
  return { green: applied && blocks.length === 0, blocks };
}
