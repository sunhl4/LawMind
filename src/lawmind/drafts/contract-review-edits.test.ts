import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  parseContractReviewEditProposals,
  proposalsToSurgicalEdits,
} from "./contract-review-edits.js";
import {
  buildRedlinePlanFromOpinion,
  writeRedlinePlanFromOpinion,
} from "./opinion-redline-plan.js";

describe("contract-review-edits", () => {
  it("sanitizes structured proposals and excludes opinion-only rows from apply", () => {
    const proposals = parseContractReviewEditProposals([
      { find: "无限责任", replace: "责任上限", priority: "P0", reason: "限责" },
      { find: "商业建议", replace: "仅写意见", mode: "opinion_only" },
      { find: "", replace: "x" },
    ]);
    expect(proposals).toHaveLength(2);
    const edits = proposalsToSurgicalEdits(proposals);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.note).toContain("P0");
  });

  it("makes structured edits primary while keeping prose compatibility", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-structured-edits-"));
    const draft: ArtifactDraft = {
      taskId: "t-structured",
      title: "合同审查",
      output: "docx",
      templateId: "contract-review",
      deliverableType: "contract.review",
      summary: "审查",
      sections: [{ heading: "修改建议", body: "「上海仲裁」→「北京仲裁」" }],
      contractReviewEdits: [
        { find: "无限责任", replace: "责任上限", priority: "P0", mode: "apply" },
      ],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const plan = writeRedlinePlanFromOpinion(tmp, draft);
    expect(plan.items.map((item) => item.find)).toEqual(
      expect.arrayContaining(["无限责任", "上海仲裁"]),
    );
    fs.rmSync(tmp, { recursive: true, force: true });

    expect(
      buildRedlinePlanFromOpinion({ taskId: "legacy", sections: draft.sections }).items,
    ).toHaveLength(1);
  });
});
