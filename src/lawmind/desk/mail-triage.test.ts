import { describe, expect, it } from "vitest";
import { classifyMailMessage } from "./mail-triage.js";

describe("classifyMailMessage", () => {
  it("flags court notices and reply-needed mail", () => {
    expect(
      classifyMailMessage({ from: "a@court.gov.cn", subject: "开庭传票", bodyText: "请到庭" }),
    ).toBe("court");
    expect(
      classifyMailMessage({ from: "client@x.com", subject: "请确认方案", bodyText: "是否同意？" }),
    ).toBe("needs_reply");
    expect(
      classifyMailMessage({
        from: "c@x.com",
        subject: "采购合同",
        attachmentNames: ["采购合同.docx"],
      }),
    ).toBe("contract");
  });

  it("skips noreply and honors extra lawyer keywords", () => {
    expect(classifyMailMessage({ from: "noreply@x.com", subject: "请尽快" })).toBe("fyi");
    expect(
      classifyMailMessage(
        { from: "c@x.com", subject: "账单", bodyText: "对账" },
        { extraReplyKeywords: ["对账"] },
      ),
    ).toBe("needs_reply");
    expect(
      classifyMailMessage({
        from: '"sunhl4" <notifications@github.com>',
        subject: "[sunhl4/QML-FF] Run failed: CI - main",
        bodyText: "View results: https://github.com/foo/actions/runs/1?email_source=notifications",
      }),
    ).toBe("fyi");
  });
});
