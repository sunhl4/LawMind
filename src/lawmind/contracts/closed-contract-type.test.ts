import { describe, expect, it } from "vitest";
import {
  CLOSED_CONTRACT_TYPE_IDS,
  formatClosedContractTypePromptBlock,
  formatLayeredReviewBodies,
  inferClosedContractType,
  shouldInjectClosedContractType,
} from "./closed-contract-type.js";

describe("closed-contract-type", () => {
  it("has exactly the 12 practice-defaults types", () => {
    expect(CLOSED_CONTRACT_TYPE_IDS).toHaveLength(12);
    expect(inferClosedContractType("请审查这份采购合同的违约责任").id).toBe("sale");
    expect(inferClosedContractType("房屋租赁合同租金条款").id).toBe("lease");
    expect(inferClosedContractType("劳动合同竞业限制").id).toBe("employment");
    expect(inferClosedContractType("保密协议 NDA 期限").id).toBe("ip");
    expect(inferClosedContractType("SaaS 平台服务协议").id).toBe("internet");
    expect(inferClosedContractType("建设工程施工合同").id).toBe("construction");
    expect(inferClosedContractType("股东协议对赌条款").id).toBe("investment");
    expect(inferClosedContractType("离婚协议财产分割").id).toBe("family");
  });

  it("dual-tags mixed deals and never blocks unknown text", () => {
    const mixed = inferClosedContractType("采购合同附件含软件许可");
    expect(mixed.id).toBe("ip");
    expect(mixed.secondary).toBe("sale");
    expect(inferClosedContractType("帮我看看这份材料").id).toBe("service");
    expect(formatClosedContractTypePromptBlock(mixed)).toContain("## 封闭合同类型");
    const layered = formatLayeredReviewBodies(inferClosedContractType("请审查这份采购合同"));
    expect(layered.macro).toContain("价款与交货");
    expect(layered.meso).toContain("框架协议");
  });

  it("skips mail and Word tracked redline", () => {
    expect(
      shouldInjectClosedContractType({ id: "contract.review", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectClosedContractType({ id: "contract.draft", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectClosedContractType({ id: "contract.review", pipeline: "tracked_redline" }),
    ).toBe(false);
    expect(
      shouldInjectClosedContractType({ id: "mail.contract", pipeline: "tracked_redline" }),
    ).toBe(false);
  });
});
