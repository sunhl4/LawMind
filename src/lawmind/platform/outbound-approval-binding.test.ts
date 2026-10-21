import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOutboundBinding,
  outboundBindingProblems,
  outboundBindingSummary,
} from "./outbound-approval-binding.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-outbound-binding-"));
}

describe("outbound approval binding", () => {
  it("accepts the same version and reports no problems", () => {
    const ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "审阅稿.docx"), "v1", "utf8");
    const mail = {
      to: "对方律师@example.com",
      subject: "审阅稿",
      body: "附上审阅稿。",
      attachmentRelativePaths: ["artifacts/审阅稿.docx"],
    };
    const binding = buildOutboundBinding(ws, mail);
    expect(outboundBindingProblems(ws, binding, mail)).toEqual([]);
  });

  it("blocks sending when the attachment changed after approval", () => {
    const ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    const abs = path.join(ws, "artifacts", "审阅稿.docx");
    fs.writeFileSync(abs, "v1", "utf8");
    const mail = {
      to: "a@example.com",
      subject: "审阅稿",
      body: "正文",
      attachmentRelativePaths: ["artifacts/审阅稿.docx"],
    };
    const binding = buildOutboundBinding(ws, mail);
    // 律师批准后文书台又导出一次，同名覆盖。
    fs.writeFileSync(abs, "v2", "utf8");
    const problems = outboundBindingProblems(ws, binding, mail);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("内容变了");
  });

  it("blocks a changed recipient, subject, body, added or dropped attachment", () => {
    const ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "a.docx"), "a", "utf8");
    fs.writeFileSync(path.join(ws, "artifacts", "b.docx"), "b", "utf8");
    const mail = {
      to: "a@example.com",
      subject: "主题",
      body: "正文",
      attachmentRelativePaths: ["artifacts/a.docx"],
    };
    const binding = buildOutboundBinding(ws, mail);

    const changed = outboundBindingProblems(ws, binding, {
      ...mail,
      to: "b@example.com",
      subject: "新主题",
      body: "新正文",
      attachmentRelativePaths: ["artifacts/b.docx"],
    });
    expect(changed.some((row) => row.includes("收件人"))).toBe(true);
    expect(changed.some((row) => row.includes("主题"))).toBe(true);
    expect(changed.some((row) => row.includes("正文"))).toBe(true);
    expect(changed.some((row) => row.includes("新增"))).toBe(true);
    expect(changed.some((row) => row.includes("不在本次发送清单"))).toBe(true);
  });

  it("treats a missing attachment at approval time as a reason to re-approve", () => {
    const ws = tmpWorkspace();
    const mail = {
      to: "a@example.com",
      subject: "主题",
      body: "正文",
      attachmentRelativePaths: ["artifacts/还没有.docx"],
    };
    const binding = buildOutboundBinding(ws, mail);
    expect(binding.attachments[0]?.version).toBeNull();
    expect(outboundBindingProblems(ws, binding, mail).length).toBe(0);
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "还没有.docx"), "late", "utf8");
    expect(outboundBindingProblems(ws, binding, mail)[0]).toContain("内容变了");
  });

  it("summarises what the approval bound for the lawyer", () => {
    const ws = tmpWorkspace();
    fs.mkdirSync(path.join(ws, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(ws, "artifacts", "a.docx"), "a", "utf8");
    const summary = outboundBindingSummary(
      buildOutboundBinding(ws, {
        to: "a@example.com",
        subject: "s",
        body: "b",
        attachmentRelativePaths: ["artifacts/a.docx"],
      }),
    );
    expect(summary).toContain("a@example.com");
    expect(summary).toContain("artifacts/a.docx");
    expect(summary).toContain("需要重新批准");
  });
});
