import { describe, expect, it } from "vitest";
import {
  formatPairedReviewDeliverablePromptBlock,
  pinsIncludeWordFile,
  shouldInjectPairedReviewDeliverable,
  wordFilePinRelPaths,
} from "./paired-review-deliverable.js";

describe("paired-review-deliverable", () => {
  const docxPin = {
    pinKind: "file" as const,
    root: "project" as const,
    relPath: "采购合同.docx",
    kind: "file" as const,
  };

  it("pairs opinion + redline only for unlocked 合同审查 with a Word pin", () => {
    expect(pinsIncludeWordFile([docxPin])).toBe(true);
    expect(
      shouldInjectPairedReviewDeliverable({ id: "contract.review", pipeline: "execute_workflow" }, [
        docxPin,
      ]),
    ).toBe(true);
    expect(
      shouldInjectPairedReviewDeliverable({ id: "contract.review", pipeline: "tracked_redline" }, [
        docxPin,
      ]),
    ).toBe(false);
    expect(
      shouldInjectPairedReviewDeliverable({ id: "mail.contract", pipeline: "execute_workflow" }, [
        docxPin,
      ]),
    ).toBe(false);
    expect(
      shouldInjectPairedReviewDeliverable(
        { id: "contract.review", pipeline: "execute_workflow" },
        [],
      ),
    ).toBe(false);
    expect(formatPairedReviewDeliverablePromptBlock()).toContain("render_tracked_draft");
    expect(wordFilePinRelPaths([docxPin])).toEqual(["采购合同.docx"]);
    expect(formatPairedReviewDeliverablePromptBlock()).toContain("意见快照");
  });
});
