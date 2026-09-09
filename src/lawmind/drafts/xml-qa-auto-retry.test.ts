import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { writeRedlinePlan } from "./redline-plan.js";
import { writeRedlineProposal } from "./redline-proposal.js";
import { applyNarrowedPlanOnce, shouldAutoRetryXmlQa } from "./xml-qa-auto-retry.js";

describe("xml-qa-auto-retry", () => {
  it("skips mail and Word tracked locks", () => {
    expect(shouldAutoRetryXmlQa({ wordRevisionTurn: true })).toBe(false);
    expect(shouldAutoRetryXmlQa({ mailContractTurn: true })).toBe(false);
    expect(shouldAutoRetryXmlQa({})).toBe(true);
  });

  it("applies narrowed plan edits onto draft sections once", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-xml-qa-"));
    const baselineBody = "乙方承担无限责任并支付违约金。";
    const draft: ArtifactDraft = {
      taskId: "t-xml",
      title: "意见",
      deliverableType: "contract.review",
      output: "docx",
      templateId: "contract-review",
      summary: "test",
      // First pass has already changed the body when XML QA runs.
      sections: [{ heading: "条款", body: "乙方承担责任上限并支付违约金。" }],
      reviewNotes: [],
      reviewStatus: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeRedlineProposal(tmp, {
      taskId: "t-xml",
      baselineSections: [{ heading: "条款", body: baselineBody }],
      hunks: [],
      updatedAt: new Date().toISOString(),
    });
    writeRedlinePlan(tmp, {
      taskId: "t-xml",
      items: [{ find: "无限责任", replace: "责任上限" }],
      skipped: [],
      updatedAt: new Date().toISOString(),
    });
    const result = applyNarrowedPlanOnce({ workspaceDir: tmp, draft });
    expect(result.attempted).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.draft?.sections[0]?.body).toContain("责任上限");
    expect(result.draft?.sections[0]?.body).not.toContain("无限责任");
  });
});
