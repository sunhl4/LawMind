import { describe, expect, it } from "vitest";
import { presentLawyerToolCall, presentLawyerToolResult } from "./tool-lawyer-card.js";

describe("presentLawyerToolCall", () => {
  it("uses Chinese titles and never surfaces snake_case ids", () => {
    const draft = presentLawyerToolCall("draft_document", { title: "解除劳动合同通知" });
    expect(draft.title).toBe("起草文书");
    expect(draft.detail).toContain("解除劳动合同通知");
    expect(JSON.stringify(draft)).not.toMatch(/draft_document/);

    const mail = presentLawyerToolCall("list_mail_inbox", { matter_id: "m1" });
    expect(mail.title).toBe("查看邮件匣");
    expect(mail.detail).toContain("m1");

    const surgical = presentLawyerToolCall("apply_surgical_edits", {
      edits: [
        { find: "a", replace: "b" },
        { find: "c", replace: "d" },
      ],
      path: "cases/m1/mail/attachments/nda.docx",
    });
    expect(surgical.title).toBe("按词修订");
    expect(surgical.detail).toContain("2 处");
    expect(surgical.detail).toContain("nda.docx");
  });

  it("covers file write, render, and send-mail cards", () => {
    expect(presentLawyerToolCall("write_document", { path: "drafts/a.md" }).title).toBe("审定文书");
    expect(presentLawyerToolCall("render_document", { task_id: "t-1" }).detail).toContain("t-1");
    expect(
      presentLawyerToolCall("send_email", { to: "a@b.com", subject: "修订稿" }).detail,
    ).toContain("a@b.com");
  });
});

describe("presentLawyerToolResult", () => {
  it("summarizes mail list and deliverable path without tool ids", () => {
    const inbox = presentLawyerToolResult("list_mail_inbox", {}, { ok: true, data: { count: 3 } });
    expect(inbox.detail).toBe("已列出 3 封");

    const render = presentLawyerToolResult(
      "render_document",
      {},
      { ok: true, data: { outputPath: "cases/m1/deliverables/函.docx" } },
    );
    expect(render.title).toBe("生成 Word 文书");
    expect(render.detail).toContain("函.docx");
    expect(JSON.stringify(render)).not.toMatch(/render_document/);
  });

  it("clips failure text", () => {
    const failed = presentLawyerToolResult("write_document", {}, { ok: false, error: "磁盘已满" });
    expect(failed.detail).toBe("磁盘已满");
  });

  it("surfaces in-loop verify coach on an otherwise successful draft", () => {
    expect(
      presentLawyerToolResult(
        "draft_document",
        {},
        {
          ok: true,
          data: { verify: { message: "引用对不上来源：src-9 不在本次检索结果中" } },
        },
      ).detail,
    ).toContain("引用对不上来源");
  });

  it("distinguishes stop and timeout", () => {
    expect(
      presentLawyerToolResult("research_task", {}, { ok: false, error: "已停止", aborted: true })
        .detail,
    ).toBe("已停止");
    expect(
      presentLawyerToolResult(
        "research_task",
        {},
        { ok: false, error: "Tool research_task timed out after 12000ms", timedOut: true },
      ).detail,
    ).toBe("已超时");
  });
});
