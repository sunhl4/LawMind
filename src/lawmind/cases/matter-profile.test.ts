import { describe, expect, it } from "vitest";
import { buildMatterProfileView, parseMatterCaseProfileFields } from "./matter-profile.js";

describe("matter-profile", () => {
  it("parses cause and counterparty from CASE §1", () => {
    const raw = `# 案件档案

## 1. 基本信息

- matterId: m1
- 案件名称（展示用）: 测试案
- 案由: 房屋租赁合同纠纷
- 对方当事人: 乙公司
- 当前阶段: 进行中

## 2. 当事人

- 甲方:
`;
    expect(parseMatterCaseProfileFields(raw)).toEqual({
      causeOfAction: "房屋租赁合同纠纷",
      counterparty: "乙公司",
    });
  });

  it("marks needsEnrichment when intake or missing fields", () => {
    expect(
      buildMatterProfileView({
        matterId: "m1",
        title: "m1",
        sensitivity: "normal",
        status: "intake",
      }).needsEnrichment,
    ).toBe(true);
    expect(
      buildMatterProfileView({
        matterId: "m1",
        title: "案",
        clientId: "c1",
        sensitivity: "normal",
        status: "active",
        causeOfAction: "合同",
      }).needsEnrichment,
    ).toBe(false);
  });
});
