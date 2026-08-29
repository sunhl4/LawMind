import { describe, expect, it } from "vitest";
import { validateDraftAgainstSpec } from "../deliverables/validator.js";
import { route } from "../router/index.js";
import type { ResearchBundle } from "../types.js";
import { buildDraft } from "./keyword-draft.js";

function emptyBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "",
    claims: [],
    sources: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("keyword-draft lawyer-work scaffolds", () => {
  it.each([
    ["起草一份律师函", "letter.counsel"],
    ["写起诉状", "litigation.complaint"],
    ["写一份法律意见书", "memo.opinion"],
    ["出具法律意见", "memo.opinion"],
    ["写一封回函", "letter.reply"],
    ["写一份保密协议", "contract.nda"],
    ["起草催告函", "letter.demand"],
    ["写一封催款律师函", "letter.demand"],
  ] as const)("%s scaffolds a %s draft without throwing", (instruction, type) => {
    const intent = route({ instruction });
    expect(intent.deliverableType).toBe(type);
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    expect(draft.deliverableType).toBe(type);
    expect(draft.sections.length).toBeGreaterThan(2);
    const report = validateDraftAgainstSpec(draft);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it("fills letter.demand headings required by the spec", () => {
    const intent = route({ instruction: "起草催告函" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const headings = draft.sections.map((s) => s.heading).join(" ");
    expect(headings).toMatch(/收函/);
    expect(headings).toMatch(/事实/);
    expect(headings).toMatch(/主张/);
    expect(headings).toMatch(/期限/);
    expect(headings).toMatch(/后果/);
    expect(headings).toMatch(/落款/);
  });

  it("rental scaffold is not ready while 【出租人】 placeholders remain", () => {
    const intent = route({ instruction: "请起草一份租赁合同" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const report = validateDraftAgainstSpec(draft);
    expect(report.ready).toBe(false);
    expect(report.placeholderSamples.join("")).toContain("【出租人");
  });

  it("letter.demand becomes ready only after placeholders are filled", () => {
    const intent = route({ instruction: "起草催告函" });
    const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
    const filled = {
      ...draft,
      sections: draft.sections.map((s) => ({
        ...s,
        body: s.body.replace(/【[^】]+】/g, "已填写事项"),
      })),
    };
    const report = validateDraftAgainstSpec(filled);
    expect(
      report.ready,
      report.checks
        .filter((c) => !c.passed)
        .map((c) => c.label)
        .join("; "),
    ).toBe(true);
  });
});
