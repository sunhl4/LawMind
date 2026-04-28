import { afterEach, describe, expect, it } from "vitest";
import {
  BUILT_IN_DELIVERABLE_SPECS,
  clearExtraDeliverableSpecs,
  getDeliverableSpec,
  listDeliverableSpecs,
  listExtraDeliverableSpecs,
  registerExtraDeliverableSpecs,
} from "./registry.js";
import type { DeliverableSpec } from "./types.js";

describe("deliverables/registry", () => {
  it("exposes built-in specs in a stable order", () => {
    const specs = listDeliverableSpecs();
    expect(specs.length).toBe(BUILT_IN_DELIVERABLE_SPECS.length);
    expect(specs.map((s) => s.type)).toEqual([
      "contract.rental",
      "contract.general",
      "letter.demand",
      "contract.review",
      "document.general",
    ]);
  });

  it("returns spec by deliverable type", () => {
    const rental = getDeliverableSpec("contract.rental");
    expect(rental).toBeDefined();
    expect(rental?.displayName).toContain("租赁");
    expect(rental?.requiredSections.length).toBeGreaterThan(0);
    expect(rental?.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("returns undefined for unknown / missing types", () => {
    expect(getDeliverableSpec(undefined)).toBeUndefined();
    // 自 DeliverableType 放宽为允许工作区扩展类型后，TS 不再报错；保留运行期注册保护。
    expect(getDeliverableSpec("nonsense.kind")).toBeUndefined();
  });

  it("each built-in spec has at least one blocker section", () => {
    for (const spec of BUILT_IN_DELIVERABLE_SPECS) {
      const blockers = spec.requiredSections.filter((s) => s.severity === "blocker");
      expect(blockers.length, `${spec.type} should declare blocker sections`).toBeGreaterThan(0);
    }
  });

  it("demand letter requires placeholders to be resolved before render", () => {
    const demand = getDeliverableSpec("letter.demand");
    expect(demand?.placeholderRule.mustResolveBeforeRender).toBe(true);
  });

  it("rental contract allows placeholders to remain (signed offline)", () => {
    const rental = getDeliverableSpec("contract.rental");
    expect(rental?.placeholderRule.mustResolveBeforeRender).toBe(false);
  });
});

describe("deliverables/registry — workspace extras", () => {
  afterEach(() => {
    clearExtraDeliverableSpecs();
  });

  function makeSpec(type: string, overrides: Partial<DeliverableSpec> = {}): DeliverableSpec {
    return {
      type,
      displayName: `自定义 ${type}`,
      description: "测试用扩展规范",
      defaultTemplateId: "custom-default",
      defaultOutput: "docx",
      defaultRiskLevel: "medium",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "签约主体", severity: "blocker" }],
      acceptanceCriteria: ["输出完整正文"],
      placeholderRule: { mustResolveBeforeRender: false },
      defaultClarificationQuestions: [],
      ...overrides,
    };
  }

  it("registers a brand-new deliverable type and exposes it via list/get", () => {
    const spec = makeSpec("contract.employment", { displayName: "劳动合同" });
    registerExtraDeliverableSpecs([spec]);
    expect(getDeliverableSpec("contract.employment")?.displayName).toBe("劳动合同");
    const merged = listDeliverableSpecs();
    expect(merged.map((s) => s.type)).toContain("contract.employment");
    expect(listExtraDeliverableSpecs().map((s) => s.type)).toEqual(["contract.employment"]);
  });

  it("overrides built-in spec when the same type is registered", () => {
    const overridden = makeSpec("contract.general", {
      displayName: "事务所版商务合同",
      acceptanceCriteria: ["新版必须含数据保护条款"],
    });
    registerExtraDeliverableSpecs([overridden]);
    const looked = getDeliverableSpec("contract.general");
    expect(looked?.displayName).toBe("事务所版商务合同");
    expect(looked?.acceptanceCriteria).toContain("新版必须含数据保护条款");

    // listDeliverableSpecs 应保留内置顺序，但用扩展替换同 type 的内置
    const merged = listDeliverableSpecs();
    const positions = merged.filter((s) => s.type === "contract.general");
    expect(positions).toHaveLength(1);
    expect(positions[0]?.displayName).toBe("事务所版商务合同");
  });

  it("clearExtraDeliverableSpecs reverts back to built-ins only", () => {
    registerExtraDeliverableSpecs([makeSpec("contract.x")]);
    expect(listExtraDeliverableSpecs()).toHaveLength(1);
    clearExtraDeliverableSpecs();
    expect(listExtraDeliverableSpecs()).toHaveLength(0);
    expect(listDeliverableSpecs().length).toBe(BUILT_IN_DELIVERABLE_SPECS.length);
  });
});
