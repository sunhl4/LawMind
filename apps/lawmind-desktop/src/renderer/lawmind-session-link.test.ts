import { describe, expect, it } from "vitest";
import {
  parseLmSessionHref,
  sanitizeChatSessionRefs,
  tryConsumeLmSessionMarkdown,
} from "./lawmind-session-link";

describe("parseLmSessionHref", () => {
  it("accepts safe ids and optional assistant, rejects traversal", () => {
    expect(parseLmSessionHref("lm-session:sess-1")).toEqual({ sessionId: "sess-1", label: "sess-1" });
    expect(parseLmSessionHref("lm-session:sess-1?a=asst-1")).toEqual({
      sessionId: "sess-1",
      label: "sess-1",
      assistantId: "asst-1",
    });
    expect(parseLmSessionHref("lm-session:../etc/passwd")).toBeNull();
    expect(parseLmSessionHref("https://evil.example/x")).toBeNull();
  });
});

describe("tryConsumeLmSessionMarkdown", () => {
  it("parses a titled cite with assistant and leaves surrounding text", () => {
    const text = "见 [采购合同审查](lm-session:abc-1?a=asst-x) 的改法。";
    const hit = tryConsumeLmSessionMarkdown(text, 2);
    expect(hit?.link).toEqual({
      sessionId: "abc-1",
      label: "采购合同审查",
      assistantId: "asst-x",
    });
    expect(text.slice(hit?.next ?? 0)).toBe(" 的改法。");
  });

  it("accepts long renamed titles up to 200 chars", () => {
    const label = "甲".repeat(120);
    const text = `[${label}](lm-session:s1)`;
    expect(tryConsumeLmSessionMarkdown(text, 0)?.link.label).toBe(label);
  });

  it("ignores generic markdown links", () => {
    expect(tryConsumeLmSessionMarkdown("[法条](https://npc.gov.cn/x)", 0)).toBeNull();
  });
});

describe("sanitizeChatSessionRefs", () => {
  it("dedupes and drops unsafe ids", () => {
    expect(
      sanitizeChatSessionRefs([
        { sessionId: "s1", title: "采购合同审查", assistantId: "asst-1" },
        { sessionId: "s1", title: "重复" },
        { sessionId: "../x", title: "坏" },
        { sessionId: "s2" },
      ]),
    ).toEqual([
      { sessionId: "s1", title: "采购合同审查", assistantId: "asst-1" },
      { sessionId: "s2", title: "s2" },
    ]);
  });
});
