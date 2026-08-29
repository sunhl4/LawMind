import { describe, expect, it } from "vitest";
import type { TaskIntent } from "../types.js";
import {
  buildResearchOutline,
  formatOutlineMarkdown,
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
    expect(outline.status).toBe("pending");
  });

  it("does not approve bare confirm phrases outside clarification resume", () => {
    expect(outlineLooksApproved("大纲已确认，请继续")).toBe(false);
    const outline = buildResearchOutline(
      intent({
        deliverableType: "report.learning",
        instruction: "学习简报。大纲已确认",
      }),
    );
    expect(outline.status).toBe("pending");
    expect(outlineClarificationQuestion(outline)?.key).toBe("research_outline_confirm");
  });

  it("marks approved only for structured clarification resume", () => {
    expect(
      outlineLooksApproved("学习简报。\n【补充信息】\n请确认大纲\n答：大纲已确认\n\n大纲已确认"),
    ).toBe(true);
  });

  it("formats markdown and clarification when pending", () => {
    const outline = buildResearchOutline(intent({ deliverableType: "ppt.training" }));
    const md = formatOutlineMarkdown(outline);
    expect(md).toContain("培训课件大纲");
    const q = outlineClarificationQuestion(outline);
    expect(q?.key).toBe("research_outline_confirm");
  });
});
