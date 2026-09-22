import { describe, expect, it } from "vitest";
import { getDeliverableSpec } from "../deliverables/registry.js";
import {
  aggregateGuardianItems,
  buildGuardianEvidencePack,
  guardianExpectedItemIds,
  guardianBlocksExport,
  parseGuardianItemVerdicts,
  parseGuardianReviewerJson,
  parseGuardianVerdict,
} from "./legal-guardian.js";
import type { GuardianEvidencePack } from "./types.js";

function packWithChecklist(
  items: Array<{ id: string; look: string; stop: string }>,
): GuardianEvidencePack {
  return buildGuardianEvidencePack({
    draft: {
      taskId: "t-1",
      title: "合作协议",
      output: "docx",
      templateId: "tpl",
      summary: "s",
      sections: [{ heading: "第一条", body: "双方应履行义务。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
      deliverableType: "contract.review",
    },
    checklist: { family: "contract", items },
  });
}

describe("P2.2 aggregateGuardianItems — verdict 由代码聚合，不由模型给", () => {
  it("全部项 supported 且无 summaryGaps → pass", () => {
    const agg = aggregateGuardianItems({
      items: [
        { id: "c1", supported: true },
        { id: "c2", supported: true },
      ],
      summaryGaps: [],
      expectedItemIds: ["c1", "c2"],
    });
    expect(agg.verdict).toBe("pass");
    expect(agg.gaps).toHaveLength(0);
  });

  it("任一项 supported:false → fail，且缺口带上该项 id", () => {
    const agg = aggregateGuardianItems({
      items: [
        { id: "c1", supported: true },
        { id: "c2", supported: false, note: "未见争议解决条款" },
      ],
      summaryGaps: [],
      expectedItemIds: ["c1", "c2"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps).toHaveLength(1);
    expect(agg.gaps[0]?.code).toBe("checklist_not_covered");
    expect(agg.gaps[0]?.message).toContain("c2");
    expect(agg.gaps[0]?.message).toContain("未见争议解决条款");
  });

  it("**缺答即 fail**（fail-closed）：漏答一项不得静默放行", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "c1", supported: true }],
      summaryGaps: [],
      expectedItemIds: ["c1", "c2"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps[0]?.code).toBe("checklist_unanswered");
    expect(agg.gaps[0]?.message).toContain("c2");
  });

  it("编造检查单里不存在的项 → fail（防「编一个通过的项」）", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "made-up", supported: true }],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.unknownItemIds).toEqual(["made-up"]);
    expect(agg.gaps.map((g) => g.code)).toContain("checklist_unknown_item");
    expect(agg.gaps.map((g) => g.code)).toContain("checklist_unanswered");
  });

  it("supported:true 但带 note → 保留为可见提示（不当作通过就吞掉）", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "c1", supported: true, note: "建议再核对期限" }],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps[0]?.code).toBe("checklist_note");
    expect(agg.gaps[0]?.message).toContain("建议再核对期限");
  });

  it("summaryGaps 非空 → fail（全文级缺口）", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "c1", supported: true }],
      summaryGaps: [{ code: "coverage", message: "实质争点未覆盖" }],
      expectedItemIds: ["c1"],
    });
    expect(agg.verdict).toBe("fail");
    expect(agg.gaps[0]?.code).toBe("coverage");
  });

  it("无检查单时只按 summaryGaps 判", () => {
    expect(
      aggregateGuardianItems({ items: [], summaryGaps: [], expectedItemIds: [] }).verdict,
    ).toBe("pass");
    expect(
      aggregateGuardianItems({
        items: [],
        summaryGaps: [{ code: "x", message: "y" }],
        expectedItemIds: [],
      }).verdict,
    ).toBe("fail");
  });

  it("重复 id 只算一次（重复不是缺口）", () => {
    const agg = aggregateGuardianItems({
      items: [
        { id: "c1", supported: true },
        { id: "c1", supported: false },
      ],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    // 保留第一个（supported:true），故 pass
    expect(agg.verdict).toBe("pass");
    expect(agg.itemVerdicts).toHaveLength(1);
  });

  it("相同缺口去重", () => {
    const agg = aggregateGuardianItems({
      items: [],
      summaryGaps: [
        { code: "dup", message: "same" },
        { code: "dup", message: "same" },
      ],
      expectedItemIds: [],
    });
    expect(agg.gaps).toHaveLength(1);
  });
});

describe("P2.2 parseGuardianItemVerdicts / parseGuardianVerdict", () => {
  it("解析逐项形状并聚合", () => {
    const raw = JSON.stringify({
      items: [
        { id: "c1", supported: true },
        { id: "c2", supported: false, note: "缺争议解决" },
      ],
      summaryGaps: [{ code: "cite", message: "引用不支撑断言" }],
    });
    const agg = parseGuardianItemVerdicts(raw, ["c1", "c2"]);
    expect(agg?.verdict).toBe("fail");
    expect(agg?.gaps.map((g) => g.code)).toEqual(["checklist_not_covered", "cite"]);
  });

  it("`supported` 缺字段按未覆盖处理（不是按通过）", () => {
    const raw = JSON.stringify({ items: [{ id: "c1", note: "说不清" }] });
    const agg = parseGuardianItemVerdicts(raw, ["c1"]);
    expect(agg?.verdict).toBe("fail");
  });

  it("markdown 围栏与尾随文本都能解析", () => {
    const raw = '```json\n{"items":[{"id":"c1","supported":true}]}\n```\n以上。';
    expect(parseGuardianItemVerdicts(raw, ["c1"])?.verdict).toBe("pass");
  });

  it("旧形状（只有 verdict/gaps）→ parseGuardianItemVerdicts 返回 undefined", () => {
    const legacy = JSON.stringify({ verdict: "pass", gaps: [] });
    expect(parseGuardianItemVerdicts(legacy, ["c1"])).toBeUndefined();
  });

  it("parseGuardianVerdict 回退旧形状，且保留旧口径的 fail-closed", () => {
    // pass + 有 gaps → 旧口径翻成 fail
    const legacy = JSON.stringify({ verdict: "pass", gaps: [{ code: "x", message: "y" }] });
    expect(parseGuardianVerdict(legacy, ["c1"])?.verdict).toBe("fail");
    // fail + 无 gaps → 旧口径补一条 unspecified
    const legacy2 = JSON.stringify({ verdict: "fail", gaps: [] });
    const parsed2 = parseGuardianVerdict(legacy2, ["c1"]);
    expect(parsed2?.verdict).toBe("fail");
    expect(parsed2?.gaps[0]?.code).toBe("unspecified");
    // 纯 pass 无 gaps
    expect(parseGuardianVerdict(JSON.stringify({ verdict: "pass", gaps: [] }), [])?.verdict).toBe(
      "pass",
    );
  });

  it("parseGuardianVerdict 优先新形状", () => {
    const raw = JSON.stringify({
      items: [{ id: "c1", supported: false, note: "缺" }],
      // 故意同时给一个与 items 矛盾的 verdict：新形状生效，旧字段被忽略
      verdict: "pass",
    });
    expect(parseGuardianVerdict(raw, ["c1"])?.verdict).toBe("fail");
  });

  it("旧解析器 parseGuardianReviewerJson 行为未变（向后兼容）", () => {
    expect(parseGuardianReviewerJson(JSON.stringify({ verdict: "pass", gaps: [] }))?.verdict).toBe(
      "pass",
    );
    expect(parseGuardianReviewerJson("not json")).toBeUndefined();
  });
});

describe("P2.2 guardianExpectedItemIds", () => {
  it("从证据包取出检查单项 id", () => {
    const pack = packWithChecklist([
      { id: "stop_1", look: "l", stop: "s" },
      { id: "stop_2", look: "l", stop: "s" },
    ]);
    expect(guardianExpectedItemIds(pack)).toEqual(["stop_1", "stop_2"]);
  });

  it("无检查单返回空数组（此时只按 summaryGaps 判）", () => {
    const pack = packWithChecklist([]);
    expect(guardianExpectedItemIds(pack)).toEqual([]);
  });
});

describe("P2.2 合同审查 spec 的检查单能变成逐项判定清单", () => {
  it("contract.review 有 reasoningGate 且能取到 spec（防 spec 被删/改名）", () => {
    const spec = getDeliverableSpec("contract.review");
    expect(spec?.reasoningGate?.required).toBe(true);
  });

  it("逐项 fail 会让 guardianBlocksExport 为真（门禁语义未变）", () => {
    const agg = aggregateGuardianItems({
      items: [{ id: "c1", supported: false, note: "缺" }],
      summaryGaps: [],
      expectedItemIds: ["c1"],
    });
    expect(guardianBlocksExport({ verdict: agg.verdict })).toBe(true);
    expect(
      guardianBlocksExport({
        verdict: aggregateGuardianItems({
          items: [{ id: "c1", supported: true }],
          summaryGaps: [],
          expectedItemIds: ["c1"],
        }).verdict,
      }),
    ).toBe(false);
  });
});
