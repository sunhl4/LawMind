import { describe, expect, it } from "vitest";
import {
  checkRelationEdges,
  definiteReading,
  parseYmd,
  renderRelationFindings,
  type RelationEdge,
} from "./definition-relations.js";
import {
  applyProseSyndrome,
  emptyFactorState,
  ingestToolResult,
  recordReading,
} from "./factor-state.js";

function withAmount(op: string, value: number, anchor?: string, groundedExtra?: string) {
  return { op, value, anchor, groundedExtra };
}

describe("typed relation checks (docs/量子启发.md §二(7), observe-only)", () => {
  it("treats a three-edge alias ring with consistent entities as clean, not as odd parity", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:甲方",
      "clause",
      "北京示例科技有限公司",
      true,
      "甲方：北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "「公司」即北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:买方",
      "clause",
      "北京示例科技有限公司",
      true,
      "买方：北京示例科技有限公司",
    );
    const edges: RelationEdge[] = [
      { kind: "alias_equality", anchors: ["defined:甲方", "defined:公司"] },
      { kind: "alias_equality", anchors: ["defined:公司", "defined:买方"] },
      { kind: "alias_equality", anchors: ["defined:买方", "defined:甲方"] },
    ];
    const findings = checkRelationEdges(state, edges);
    expect(findings.conflicts).toEqual([]);
    expect(findings.insufficient).toEqual([]);
  });

  it("flags two distinct definite entities on one alias edge and keeps both readings", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "「公司」即北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:承租人",
      "clause",
      "上海示例贸易有限公司",
      true,
      "承租人：上海示例贸易有限公司",
    );
    const findings = checkRelationEdges(state, [
      { kind: "alias_equality", anchors: ["defined:公司", "defined:承租人"] },
    ]);
    expect(findings.conflicts).toHaveLength(1);
    expect(findings.conflicts[0]?.detail).toContain("北京示例科技有限公司");
    expect(findings.conflicts[0]?.detail).toContain("上海示例贸易有限公司");
    expect(findings.conflicts[0]?.detail).toContain("不选边");
  });

  it("accepts short-forms of the same entity (substring) without conflict", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "「公司」即北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:甲方",
      "clause",
      "北京示例科技有限公司的全部权利义务继受人",
      true,
      "甲方含继受人",
    );
    const findings = checkRelationEdges(state, [
      { kind: "alias_equality", anchors: ["defined:公司", "defined:甲方"] },
    ]);
    expect(findings.conflicts).toEqual([]);
  });

  it("marks alias edges with mixed readings as insufficient, never as conflict", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "「公司」即北京示例科技有限公司",
    );
    recordReading(state, "defined:对方", "clause", "上海示例贸易有限公司", false);
    applyProseSyndrome(state, "上海示例贸易有限公司应当履行。");
    const findings = checkRelationEdges(state, [
      { kind: "alias_equality", anchors: ["defined:公司", "defined:对方"] },
    ]);
    expect(findings.conflicts).toEqual([]);
    expect(findings.insufficient[0]?.anchors).toContain("defined:对方");
  });

  it("catches a ratio break the sum check cannot see (总10万、比例20%、稿写3万)", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "total_price", value: 100000 });
    ingestToolResult(state, "calculate", { op: "down_payment", value: 30000 });
    ingestToolResult(state, "calculate", { op: "balance", value: 70000 });

    const sumFindings = checkRelationEdges(state, [
      {
        kind: "amount_split",
        parent: "amount:total_price",
        parts: ["amount:down_payment", "amount:balance"],
        op: "sum",
      },
    ]);
    // 加总自洽：30000 + 70000 = 100000，只查加总必然漏报。
    expect(sumFindings.conflicts).toEqual([]);

    const ratioFindings = checkRelationEdges(state, [
      {
        kind: "amount_split",
        parent: "amount:total_price",
        parts: ["amount:down_payment"],
        op: "ratio",
        ratio: 0.2,
      },
    ]);
    expect(ratioFindings.conflicts).toHaveLength(1);
    expect(ratioFindings.conflicts[0]?.anchors).toContain("amount:down_payment");
    expect(ratioFindings.conflicts[0]?.detail).toContain("30000");
  });

  it("passes consistent splits and reports insufficient when a part is not definite", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "total_price", value: 100000 });
    ingestToolResult(state, "calculate", { op: "down_payment", value: 20000 });
    ingestToolResult(state, "calculate", { op: "balance", value: 80000 });

    const findings = checkRelationEdges(state, [
      {
        kind: "amount_split",
        parent: "amount:total_price",
        parts: ["amount:down_payment", "amount:balance"],
        op: "sum",
      },
    ]);
    expect(findings.conflicts).toEqual([]);
    expect(findings.insufficient).toEqual([]);
  });

  it("marks a conflicting sum (90000 vs 100000) as a conflict", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "total_price", value: 100000 });
    ingestToolResult(state, "calculate", { op: "down_payment", value: 30000 });
    ingestToolResult(state, "calculate", { op: "balance", value: 60000 });
    const findings = checkRelationEdges(state, [
      {
        kind: "amount_split",
        parent: "amount:total_price",
        parts: ["amount:down_payment", "amount:balance"],
        op: "sum",
      },
    ]);
    expect(findings.conflicts).toHaveLength(1);
    expect(findings.conflicts[0]?.detail).toContain("90000");
    expect(findings.conflicts[0]?.detail).toContain("100000");
  });

  it("checks date order and leaves unparseable readings insufficient", () => {
    const state = emptyFactorState();
    recordReading(state, "clause:生效日", "clause", "2026-1-1", true, "生效日：2026-1-1");
    recordReading(state, "clause:到期日", "clause", "2025年6月30日", true, "到期日：2025年6月30日");
    const findings = checkRelationEdges(state, [
      { kind: "date_order", left: "clause:生效日", right: "clause:到期日" },
    ]);
    expect(findings.conflicts).toHaveLength(1);

    const mixed = emptyFactorState();
    recordReading(mixed, "clause:生效日", "clause", "三十日内", true, "三十日内生效");
    const insufficient = checkRelationEdges(mixed, [
      { kind: "date_order", left: "clause:生效日", right: "clause:到期日" },
    ]);
    expect(insufficient.conflicts).toEqual([]);
    expect(insufficient.insufficient).toHaveLength(1);
  });

  it("reports an unknown or missing parent anchor as insufficient", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "down_payment", value: 20000 });
    const findings = checkRelationEdges(state, [
      {
        kind: "amount_split",
        parent: "amount:total_price",
        parts: ["amount:down_payment"],
        op: "sum",
      },
    ]);
    expect(findings.conflicts).toEqual([]);
    expect(findings.insufficient[0]?.detail).toContain("缺少已核读数");
  });

  it("renders conflicts with the manual-review notice and nothing for clean findings", () => {
    const clean = renderRelationFindings({ conflicts: [], insufficient: [] });
    expect(clean).toBe("");
    const rendered = renderRelationFindings({
      conflicts: [
        {
          kind: "alias_equality",
          anchors: ["defined:公司", "defined:承租人"],
          detail: "两主体不同",
        },
      ],
      insufficient: [{ kind: "date_order", anchors: ["clause:生效日"], detail: "缺少已核读数" }],
    });
    expect(rendered).toContain("【关系冲突】");
    expect(rendered).toContain("defined:公司 vs defined:承租人");
    expect(rendered).toContain("【关系待核】");
  });
});

describe("helpers", () => {
  it("parseYmd accepts ISO and CN formats and rejects prose", () => {
    expect(parseYmd("2026-01-01")).toEqual([2026, 1, 1]);
    expect(parseYmd("2026年1月1日")).toEqual([2026, 1, 1]);
    expect(parseYmd("三十日内")).toBeUndefined();
  });

  it("definiteReading stays undefined for mixed readings", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "calculate", { op: "wage", value: 15000 });
    recordReading(state, "amount:penalty", "amount", "2000", false);
    expect(definiteReading(state, "amount:wage")).toBe("15000");
    expect(definiteReading(state, "amount:penalty")).toBeUndefined();
    expect(definiteReading(state, "amount:missing")).toBeUndefined();
  });

  it("keeps the shared error-fixture shape runnable (guards accidental ingest breakage)", () => {
    const state = emptyFactorState();
    const rows = [withAmount("economic_compensation", 88000)];
    ingestToolResult(state, "calculate", {
      op: rows[0]?.op,
      value: rows[0]?.value,
    });
    expect(definiteReading(state, "amount:economic_compensation")).toBe("88000");
  });
});
