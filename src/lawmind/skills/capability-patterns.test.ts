import { describe, expect, it } from "vitest";
import {
  COMPUTE_INTENT_RE,
  COMPUTE_TABLE_PACK_RE,
  FAMILY_MATTER_RE,
  QUICK_TRIAGE_RE,
  isPublicWebFactLookup,
  publicWebFactToolRefusal,
} from "./capability-patterns.js";
import { bindLawyerCapability } from "./lawyer-capabilities.js";

describe("capability-patterns", () => {
  it("recognizes table and chart work without treating contract review as compute", () => {
    expect(COMPUTE_INTENT_RE.test("请分析这张费用表并出图")).toBe(true);
    expect(COMPUTE_INTENT_RE.test("把这张表汇总成对照表")).toBe(true);
    expect(COMPUTE_INTENT_RE.test("请审查这份采购合同")).toBe(false);
    expect(COMPUTE_INTENT_RE.test("修改合同")).toBe(false);
  });

  it("routes table packs without stealing contract review", () => {
    expect(COMPUTE_TABLE_PACK_RE.test("把这张表汇总成对照表")).toBe(true);
    expect(COMPUTE_TABLE_PACK_RE.test("请审查这份采购合同.xlsx")).toBe(false);
  });

  it("treats 新说唱总冠军 as public web, not legal research", () => {
    expect(isPublicWebFactLookup("查一下2026年新说唱总冠军")).toBe(true);
    expect(isPublicWebFactLookup("2026年新说唱总冠军")).toBe(true);
    expect(isPublicWebFactLookup("查一下民法典违约责任")).toBe(false);
    expect(isPublicWebFactLookup("查一下违约责任")).toBe(false);
    expect(isPublicWebFactLookup("2025 年个人信息保护监管动态")).toBe(false);
    expect(publicWebFactToolRefusal("查一下2026年新说唱总冠军", false)).toContain("联网");
    expect(publicWebFactToolRefusal("查一下2026年新说唱总冠军", true)).toContain("web_search");
    expect(publicWebFactToolRefusal("查一下民法典违约责任", false)).toBeNull();
  });

  it("keeps bind and the shared matcher on the same 快问 / 家事 cues", () => {
    expect(QUICK_TRIAGE_RE.test("他一直拖欠工资这算不算违法")).toBe(true);
    expect(bindLawyerCapability({ instruction: "他一直拖欠工资这算不算违法" })?.id).toBe(
      "analysis.quick",
    );
    expect(FAMILY_MATTER_RE.test("这份离婚诉讼材料怎么主张抚养权")).toBe(true);
    expect(bindLawyerCapability({ instruction: "这份离婚诉讼材料怎么主张抚养权" })?.id).toBe(
      "family.matter",
    );
  });
});
