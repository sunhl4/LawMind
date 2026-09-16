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

  it("labels update_plan as a lawyer-facing checklist, not a snake_case tool", () => {
    const card = presentLawyerToolCall("update_plan", {
      plan: [
        { step: "读合同", status: "in_progress" },
        { step: "标风险", status: "pending" },
      ],
    });
    expect(card.title).toBe("本轮步骤");
    expect(card.detail).toBe("2 步");
    expect(JSON.stringify(card)).not.toMatch(/update_plan/);
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

  it("hides compute source and shows deliverable summary", () => {
    const call = presentLawyerToolCall("run_compute", {
      source: "const t = await readTable('fees.xlsx')",
      purpose: "汇总费用并出图",
    });
    expect(call.title).toBe("核算数据");
    expect(call.detail).toBe("汇总费用并出图");
    expect(JSON.stringify(call)).not.toMatch(/readTable|run_compute|source/);

    const result = presentLawyerToolResult(
      "run_compute",
      { source: "return 1" },
      {
        ok: true,
        data: { lawyerSummary: "已出核算对照 费用.xlsx · 已出图「费用」 · 已进在办" },
      },
    );
    expect(result.detail).toContain("已出核算对照");
    expect(JSON.stringify(result)).not.toMatch(/return 1|run_compute/);

    const failed = presentLawyerToolResult(
      "run_compute",
      { source: "require('fs')" },
      { ok: false, error: "脚本含有禁止的接口（fs/fetch/process/require 等）。" },
    );
    expect(failed.detail).toBe("核算未完成");
    expect(JSON.stringify(failed)).not.toMatch(/脚本|require|fs/);
  });

  it("clips failure text", () => {
    const failed = presentLawyerToolResult("write_document", {}, { ok: false, error: "磁盘已满" });
    expect(failed.detail).toBe("磁盘已满");
  });

  it("ok:false same-turn envelope uses error, not a duplicated verify.message", () => {
    const card = presentLawyerToolResult(
      "apply_surgical_edits",
      {},
      {
        ok: false,
        error:
          "【同一回合验收未过】验证器未绿，本回合不得结束。请立即调用 apply_surgical_edits，不要回复「已完成」。",
        data: {
          verify: { codes: ["empty_redline"], nextTool: "apply_surgical_edits" },
        },
      },
    );
    expect(card.detail).toBe("未产生可核验修订");
    expect(card.detail).not.toContain("apply_surgical_edits");
    expect(card.detail).not.toContain("同一回合验收未过");
  });

  it("hides XML-QA bounce protocol on the lawyer card", () => {
    const card = presentLawyerToolResult(
      "render_tracked_draft",
      {},
      {
        ok: false,
        error:
          "【同一回合验收未过】验证器未绿，本回合不得结束。请立即调用 render_tracked_draft，不要回复「已完成」。",
        data: {
          verify: { codes: ["xml_qa_fail"], nextTool: "render_tracked_draft" },
        },
      },
    );
    expect(card.detail).toBe("导出未见审阅痕迹，请重导");
    expect(card.detail).not.toContain("render_tracked_draft");
    expect(card.detail).not.toContain("同一回合验收未过");
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

  it("summarizes other-chat search hits without snake_case ids", () => {
    const call = presentLawyerToolCall("search_conversations", { query: "上周 合同审查" });
    expect(call.title).toBe("检索其他对话");
    expect(call.detail).toContain("合同审查");
    const found = presentLawyerToolResult(
      "search_conversations",
      { query: "合同审查" },
      {
        ok: true,
        data: {
          total: 2,
          hits: [
            { sessionId: "s1", title: "采购合同审查" },
            { sessionId: "s2", title: "保密协议" },
          ],
        },
      },
    );
    expect(found.detail).toContain("命中 2 条");
    expect(found.detail).toContain("采购合同审查");
    expect(JSON.stringify(found)).not.toMatch(/search_conversations/);
    expect(
      presentLawyerToolResult(
        "search_conversations",
        {},
        { ok: true, data: { total: 0, hits: [] } },
      ).detail,
    ).toBe("没有命中其他对话");
    expect(
      presentLawyerToolResult(
        "read_conversation",
        {},
        { ok: true, data: { sessionId: "s1", title: "改稿做法" } },
      ).detail,
    ).toContain("改稿做法");
  });
});
