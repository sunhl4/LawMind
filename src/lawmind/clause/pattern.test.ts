import { describe, expect, it } from "vitest";
import { defineClause, definitions, dispute, liability, obligations } from "./dsl.js";
import { extractCaptureBody, findFirstTrigger, matchesTrigger } from "./pattern.js";

describe("ClausePattern builders", () => {
  it("defineClause produces a pattern with defaults", () => {
    const p = defineClause("obligation", "保密义务", {
      triggers: ["保密", "不得泄露"],
    });
    expect(p.type).toBe("obligation");
    expect(p.name).toBe("保密义务");
    expect(p.triggers).toContain("保密");
  });

  it("default family patterns cover major clause types", () => {
    const defs = definitions();
    expect(defs.type).toBe("definition");
    expect(matchesTrigger("本合同所称「保密信息」", defs.triggers)).toBe(true);

    const ob = obligations();
    expect(ob.type).toBe("obligation");
    expect(matchesTrigger("接收方应当保密", ob.triggers)).toBe(true);

    const liab = liability();
    expect(liab.type).toBe("liability");
    expect(liab.children).toHaveLength(2);
    expect(liab.children?.map((c) => c.name)).toContain("赔偿上限");
    expect(liab.children?.map((c) => c.name)).toContain("不可抗力");

    const disp = dispute();
    expect(disp.type).toBe("dispute");
  });
});

describe("trigger utilities", () => {
  it("findFirstTrigger returns first string or regex hit", () => {
    expect(findFirstTrigger("abc", ["b", "c"])?.text).toBe("b");
    expect(findFirstTrigger("abc", [/b/, /c/])?.text).toBe("b");
    expect(findFirstTrigger("abc", ["z"])).toBeUndefined();
  });

  it("extractCaptureBody uses named body group when present", () => {
    const body = extractCaptureBody("赔偿上限为100万元。其他内容。", {
      bodyRe: /赔偿上限为(?<body>[^。]+)/,
    });
    expect(body).toBe("100万元");
  });

  it("extractCaptureBody falls back to first 200 chars when no capture", () => {
    const text = "x".repeat(500);
    expect(extractCaptureBody(text, undefined)).toHaveLength(200);
  });
});
