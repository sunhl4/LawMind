import { describe, expect, it } from "vitest";
import {
  alreadyHasMailBlock,
  applyMailSendFormat,
  buildMailSendFormatPrompt,
  formatMailFromAddress,
  hasMailSendFormat,
  previewMailSendFormat,
  resolveMailClosingText,
  sanitizeMailSendFormat,
} from "./mail-send-format.js";

describe("mail-send-format", () => {
  it("sanitize drops empty defaults and trims fields", () => {
    expect(sanitizeMailSendFormat({})).toBeUndefined();
    expect(sanitizeMailSendFormat({ fromName: "  ", closingStyle: "none" })).toBeUndefined();
    expect(
      sanitizeMailSendFormat({
        fromName: "  张三律师  ",
        closingStyle: "formal",
        signature: "某某律师事务所\n张三 律师\n",
      }),
    ).toEqual({
      fromName: "张三律师",
      closingStyle: "formal",
      signature: "某某律师事务所\n张三 律师",
    });
    expect(sanitizeMailSendFormat({ appendIfMissing: false })).toEqual({ appendIfMissing: false });
  });

  it("resolveMailClosingText maps presets and custom", () => {
    expect(resolveMailClosingText({ closingStyle: "formal" })).toBe("此致\n敬礼");
    expect(resolveMailClosingText({ closingStyle: "business" })).toBe("顺颂商祺");
    expect(resolveMailClosingText({ closingStyle: "reply" })).toBe("此复");
    expect(resolveMailClosingText({ closingStyle: "custom", customClosing: "专此奉达" })).toBe(
      "专此奉达",
    );
    expect(resolveMailClosingText({ closingStyle: "none" })).toBe("");
  });

  it("applyMailSendFormat appends closing + signature once", () => {
    const format = {
      closingStyle: "formal" as const,
      signature: "某某律师事务所\n张三 律师",
    };
    const first = applyMailSendFormat("请查收修订稿。", format);
    expect(first).toBe("请查收修订稿。\n\n此致\n敬礼\n\n某某律师事务所\n张三 律师");
    expect(applyMailSendFormat(first, format)).toBe(first);
    expect(applyMailSendFormat("请查收。此致敬礼某某律师事务所张三律师", format)).toBe(
      "请查收。此致敬礼某某律师事务所张三律师",
    );
  });

  it("applyMailSendFormat respects appendIfMissing=false", () => {
    expect(applyMailSendFormat("正文", { signature: "落款", appendIfMissing: false })).toBe("正文");
  });

  it("alreadyHasMailBlock ignores whitespace", () => {
    expect(alreadyHasMailBlock("此致\n\n敬礼", "此致\n敬礼")).toBe(true);
    expect(alreadyHasMailBlock("hello", "此致")).toBe(false);
  });

  it("formatMailFromAddress uses display name when set", () => {
    expect(formatMailFromAddress("a@b.com")).toEqual({ address: "a@b.com" });
    expect(formatMailFromAddress("a@b.com", { fromName: "张三律师" })).toEqual({
      name: "张三律师",
      address: "a@b.com",
    });
  });

  it("preview and prompt surface the configured 落款", () => {
    const format = {
      fromName: "张三律师",
      closingStyle: "business" as const,
      signature: "某某律师事务所",
    };
    expect(previewMailSendFormat(format)).toContain("顺颂商祺");
    expect(previewMailSendFormat(format)).toContain("某某律师事务所");
    const prompt = buildMailSendFormatPrompt(format);
    expect(prompt).toContain("## 外发邮件落款");
    expect(prompt).toContain("张三律师");
    expect(prompt).toContain("顺颂商祺");
    expect(hasMailSendFormat(format)).toBe(true);
    expect(buildMailSendFormatPrompt({})).toBeUndefined();
  });
});
