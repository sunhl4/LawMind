import { describe, expect, it } from "vitest";
import {
  formatToolArgsDiffPreview,
  toolArgsAreDocumentWrite,
  toolArgsDiffPreviewText,
  toolArgsHaveLawyerEditableShortFields,
  toolArgsHaveShortEditFields,
  toolArgsLinkedTaskId,
} from "./tool-approval-diff.js";

describe("tool-approval-diff", () => {
  it("shows lawyer-facing labels and redacts secrets", () => {
    const lines = formatToolArgsDiffPreview({
      workflowId: "nda-standard-review",
      api_key: "super-secret",
      nested: { a: 1 },
    });
    expect(lines.some((l) => l.key === "办案流程" && l.value.includes("nda"))).toBe(true);
    expect(lines.find((l) => l.key === "相关内容" || l.value === "（已隐藏）")?.value).toBe(
      "（已隐藏）",
    );
    expect(lines.some((l) => l.key === "相关内容" && l.kind === "nested")).toBe(true);
    expect(toolArgsDiffPreviewText({ title: "保密协议" })).toContain("标题：保密协议");
  });

  it("does not dump write_document content blobs", () => {
    const lines = formatToolArgsDiffPreview({
      file_path: "drafts/t1.json",
      content: JSON.stringify({
        taskId: "t1",
        sections: [{ heading: "一", body: "x".repeat(200) }],
      }),
    });
    expect(lines.find((l) => l.key === "保存位置")?.value).toContain("drafts");
    expect(lines.find((l) => l.key === "文书内容")?.value).toMatch(/从略/);
    expect(lines.every((l) => !l.key.includes("_"))).toBe(true);
  });

  it("extractApprovalDocumentPreview returns full body for desk reading", async () => {
    const { extractApprovalDocumentPreview } = await import("./tool-approval-diff.js");
    const doc = extractApprovalDocumentPreview({
      file_path: "drafts/多线诉讼时序管控矩阵.md",
      content: "# 多线诉讼时序管控矩阵\n\n> **密级**: 律师工作秘密\n\n正文第一段。\n\n正文第二段。",
    });
    expect(doc?.title).toBe("多线诉讼时序管控矩阵");
    expect(doc?.body).toContain("正文第二段");
    expect(doc?.meta.some((m) => m.includes("密级"))).toBe(true);
  });

  it("toolArgsAreDocumentWrite distinguishes 文书 content from email body", () => {
    expect(
      toolArgsAreDocumentWrite({
        file_path: "drafts/a.md",
        content: "# 标题\n\n正文",
      }),
    ).toBe(true);
    expect(toolArgsAreDocumentWrite({ body: "邮件一两句", to: "a@b.com" })).toBe(false);
    expect(
      toolArgsAreDocumentWrite({
        content: "办案笔记正文",
        section: "progress",
        matter_id: "m1",
      }),
    ).toBe(false);
    expect(toolArgsHaveShortEditFields({ file_path: "drafts/a.md", content: "x" })).toBe(true);
    expect(toolArgsHaveLawyerEditableShortFields({ file_path: "drafts/a.md", content: "x" })).toBe(
      false,
    );
    expect(
      toolArgsHaveLawyerEditableShortFields({
        file_path: "drafts/a.md",
        content: "x",
        title: "标题",
      }),
    ).toBe(true);
    expect(toolArgsLinkedTaskId({ taskId: "t-1", content: "x" })).toBe("t-1");
  });

  it("toolArgsLinkedTaskId prefers taskId then task_id and ignores blank", () => {
    expect(toolArgsLinkedTaskId({ task_id: "tid-a", taskId: "tid-b" })).toBe("tid-b");
    expect(toolArgsLinkedTaskId({ task_id: "tid-a" })).toBe("tid-a");
    expect(toolArgsLinkedTaskId({ taskId: "  " })).toBeNull();
    expect(toolArgsLinkedTaskId({})).toBeNull();
  });

  it("redacts long nested blobs and keeps short scalars", () => {
    const lines = formatToolArgsDiffPreview({
      note: "短备注",
      payload: { nested: "x".repeat(400) },
    });
    expect(lines.some((l) => l.value === "短备注")).toBe(true);
    expect(lines.some((l) => l.kind === "nested" || String(l.value).includes("从略"))).toBe(true);
  });
});
