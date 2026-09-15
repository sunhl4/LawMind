import { describe, expect, it } from "vitest";
import { classifyOutboundAudience, classifyOutboundPrivilege } from "./outbound-audience.js";

describe("classifyOutboundAudience", () => {
  it("flags court-like recipients", () => {
    const v = classifyOutboundAudience({ to: "case@court.gov.cn", subject: "起诉材料" });
    expect(v.kind).toBe("court");
    expect(v.warning).toMatch(/法院/);
  });

  it("flags opposing-counsel copy", () => {
    const v = classifyOutboundAudience({
      to: "lawyer@example.com",
      subject: "回复对方律师",
      body: "致对方律师：",
    });
    expect(v.kind).toBe("opposing");
  });

  it("treats client mail as client", () => {
    expect(classifyOutboundAudience({ to: "a@b.com", subject: "给委托人的进度" }).kind).toBe(
      "client",
    );
  });

  it("flags attachment names that look privileged", () => {
    const v = classifyOutboundPrivilege({
      to: "opposing@x.com",
      subject: "回复对方律师",
      body: "致对方律师：请查收。",
      attachmentPaths: ["artifacts/内部策略-底线.docx"],
    });
    expect(v.audience.kind).toBe("opposing");
    expect(v.attachmentFlags.length).toBeGreaterThan(0);
  });
});
