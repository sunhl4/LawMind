import { describe, expect, it } from "vitest";
import type { TaskIntent } from "../types.js";
import {
  buildResearchOutline,
  formatOutlineMarkdown,
  lawyerWantsOutlineHold,
  outlineClarificationQuestion,
  outlineLooksApproved,
} from "./research-outline.js";

function intent(partial: Partial<TaskIntent>): TaskIntent {
  return {
    taskId: "t1",
    kind: "draft.word",
    output: "docx",
    instruction: "做一份涉外合规卷宗",
    summary: "数据跨境合规",
    ...partial,
  };
}

describe("research-outline", () => {
  it("builds compliance outline with jurisdiction section", () => {
    const outline = buildResearchOutline(
      intent({ deliverableType: "report.compliance", instruction: "跨境合规 欧盟" }),
    );
    expect(outline.sections.some((s) => s.id === "jurisdiction")).toBe(true);
    expect(outline.status).toBe("approved");
  });

  it("holds the outline only when the lawyer asked to confirm first", () => {
    expect(outlineLooksApproved("大纲已确认，请继续")).toBe(false);
    expect(lawyerWantsOutlineHold("学习简报。大纲已确认")).toBe(false);
    const writing = buildResearchOutline(
      intent({
        deliverableType: "report.learning",
        instruction: "学习简报。大纲已确认",
      }),
    );
    expect(writing.status).toBe("approved");
    expect(outlineClarificationQuestion(writing)).toBeNull();
    const held = buildResearchOutline(
      intent({
        deliverableType: "report.learning",
        instruction: "先出大纲，确认后再写学习简报",
      }),
    );
    expect(held.status).toBe("pending");
    expect(outlineClarificationQuestion(held)?.key).toBe("research_outline_confirm");
  });

  it("marks approved only for structured clarification resume", () => {
    expect(
      outlineLooksApproved("学习简报。\n【补充信息】\n请确认大纲\n答：大纲已确认\n\n大纲已确认"),
    ).toBe(true);
  });

  it("formats markdown and asks only when the outline is held", () => {
    const outline = buildResearchOutline(
      intent({ deliverableType: "ppt.training", instruction: "先出大纲，做培训课件" }),
    );
    const md = formatOutlineMarkdown(outline);
    expect(md).toContain("培训课件大纲");
    const q = outlineClarificationQuestion(outline);
    expect(q?.key).toBe("research_outline_confirm");
  });
});
