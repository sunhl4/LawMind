/**
 * LegalReasoningGraph 单元测试
 */

import { describe, expect, it } from "vitest";
import type { ResearchBundle, TaskIntent } from "../types.js";
import {
  buildLegalReasoningGraph,
  parseLegalReasoningGraphMeta,
  serializeLegalReasoningGraph,
} from "./legal-graph.js";

// ─────────────────────────────────────────────
// 测试用 fixture
// ─────────────────────────────────────────────

function makeBundle(overrides: Partial<ResearchBundle> = {}): ResearchBundle {
  return {
    taskId: "task-001",
    query: "违约金条款合法性",
    sources: [
      {
        id: "src-statute-1",
        title: "《民法典》第585条",
        kind: "statute",
        citation: "《民法典》第585条第1款",
      },
      {
        id: "src-case-1",
        title: "（2023）京民终12345号",
        kind: "case",
        citation: "（2023）京民终12345号",
        court: "北京市高级人民法院",
        caseNumber: "（2023）京民终12345号",
      },
    ],
    claims: [
      {
        text: "违约金可由当事人约定，但不得过分高于或低于实际损失",
        sourceIds: ["src-statute-1"],
        confidence: 0.92,
        model: "legal",
      },
      {
        text: "法院有权适当调整过高违约金",
        sourceIds: ["src-statute-1", "src-case-1"],
        confidence: 0.85,
        model: "legal",
      },
    ],
    riskFlags: ["违约金数额可能被法院调减"],
    missingItems: ["需确认合同中是否有预定损失条款"],
    requiresReview: false,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeIntent(overrides: Partial<TaskIntent> = {}): TaskIntent {
  return {
    taskId: "task-001",
    kind: "analyze.contract",
    output: "docx",
    instruction: "请审查合同违约金条款",
    summary: "合同违约金条款审查",
    riskLevel: "medium",
    models: ["legal"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// 构建测试
// ─────────────────────────────────────────────

describe("buildLegalReasoningGraph", () => {
  it("构建出正确数量的争点节点", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    expect(graph.issueTree).toHaveLength(2);
  });

  it("设置正确的 taskId 和 matterId", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent({ taskId: "task-xyz", matterId: "matter-abc" }),
      bundle: makeBundle({ taskId: "task-xyz" }),
    });
    expect(graph.taskId).toBe("task-xyz");
    expect(graph.matterId).toBe("matter-abc");
  });

  it("整体置信度为争点置信度均值", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    const expected = (0.92 + 0.85) / 2;
    expect(graph.overallConfidence).toBeCloseTo(expected, 5);
  });

  it("论证矩阵条目数与结论数一致", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    expect(graph.argumentMatrix).toHaveLength(2);
  });

  it("来源含类案时 evidenceBacked = true", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    // 第二条结论有 src-case-1（kind: "case"）
    expect(graph.argumentMatrix[1].evidenceBacked).toBe(true);
  });

  it("来源仅有法条时 evidenceBacked = false", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    // 第一条结论只有 src-statute-1（kind: "statute"）
    expect(graph.argumentMatrix[0].evidenceBacked).toBe(false);
  });

  it("riskFlags 映射到 deliveryRisks", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    expect(graph.deliveryRisks.some((r) => r.includes("违约金数额可能被法院调减"))).toBe(true);
  });

  it("missingItems 映射到 deliveryRisks", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle(),
    });
    expect(graph.deliveryRisks.some((r) => r.includes("需确认合同中是否有预定损失条款"))).toBe(
      true,
    );
  });

  it("置信度低于 0.5 的结论触发额外交付风险", () => {
    const bundle = makeBundle({
      claims: [
        { text: "不确定主张", sourceIds: ["src-statute-1"], confidence: 0.3, model: "general" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.deliveryRisks.some((r) => r.includes("置信度 < 50%"))).toBe(true);
  });

  it("空 bundle 返回空争点树和零置信度", () => {
    const bundle = makeBundle({ claims: [], sources: [], riskFlags: [], missingItems: [] });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.issueTree).toHaveLength(0);
    expect(graph.overallConfidence).toBe(0);
  });

  it("P0-4b：同一主题 + 仅共享同一权威 → 不报权威冲突（推论分歧不是权威冲突）", () => {
    const bundle = makeBundle({
      claims: [
        {
          text: "违约金约定过高应予调减",
          sourceIds: ["src-statute-1"],
          confidence: 0.9,
          model: "legal",
        },
        {
          text: "违约金约定可自由裁量",
          sourceIds: ["src-statute-1"],
          confidence: 0.5,
          model: "legal",
        },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    // 两条结论依据同一条法条 → 分歧在推论，不在权威。旧实现在这里误报。
    expect(graph.authorityConflicts).toHaveLength(0);
  });

  it("P0-4b：同一主题 + 依据不同权威 + 置信度差 > 0.3 → 报权威冲突", () => {
    const bundle = makeBundle({
      claims: [
        {
          text: "违约金应按实际损失调减",
          sourceIds: ["src-statute-1"],
          confidence: 0.9,
          model: "legal",
        },
        { text: "违约金不应调减", sourceIds: ["src-case-1"], confidence: 0.5, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.authorityConflicts).toHaveLength(1);
    // authorityIds 是两条结论各自权威的并集——正是需要律师权衡的对象
    expect(graph.authorityConflicts[0].authorityIds).toEqual(
      expect.arrayContaining(["src-statute-1", "src-case-1"]),
    );
    expect(graph.authorityConflicts[0].conflict).toContain("违约金");
    expect(graph.authorityConflicts[0].resolved).toBe(false);
  });

  it("P0-4b：主题不同 + 依据不同权威 → 不报冲突（这是旧实现的核心误报）", () => {
    const bundle = makeBundle({
      claims: [
        {
          text: "违约金约定过高应予调减",
          sourceIds: ["src-statute-1"],
          confidence: 0.95,
          model: "legal",
        },
        { text: "诉讼时效为三年", sourceIds: ["src-case-1"], confidence: 0.5, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    // 两个不相关的结论各自引不同权威，不该被报成「权威冲突」
    expect(graph.authorityConflicts).toHaveLength(0);
  });

  it("P0-4b：主题识别不出 → 不报冲突（宁缺勿滥，门禁语境误报代价更高）", () => {
    const bundle = makeBundle({
      claims: [
        { text: "结论 A", sourceIds: ["src-statute-1"], confidence: 0.9, model: "legal" },
        { text: "结论 B", sourceIds: ["src-case-1"], confidence: 0.5, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.authorityConflicts).toHaveLength(0);
  });

  it("P0-4b：同一主题 + 依据不同权威但置信度差 <= 0.3 → 不报冲突", () => {
    const bundle = makeBundle({
      claims: [
        { text: "违约金应调减", sourceIds: ["src-statute-1"], confidence: 0.9, model: "legal" },
        { text: "违约金不宜调减", sourceIds: ["src-case-1"], confidence: 0.65, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.authorityConflicts).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// P0-4a：facts 填充与来源 kind 归类
// ─────────────────────────────────────────────

describe("IRAC 槽位映射（P0-4a）", () => {
  it("三个集合互斥，且合起来覆盖全部 SourceKind（新增 kind 必须归类）", async () => {
    const { IRAC_SOURCE_KIND_COVERAGE } = await import("./legal-graph.js");
    const allKinds = [
      "statute",
      "regulation",
      "case",
      "memo",
      "contract",
      "web",
      "workspace",
      "unknown",
    ] as const;
    const groups = [
      IRAC_SOURCE_KIND_COVERAGE.authority,
      IRAC_SOURCE_KIND_COVERAGE.evidence,
      IRAC_SOURCE_KIND_COVERAGE.facts,
    ];
    const seen = new Set<string>();
    for (const g of groups) {
      for (const k of g) {
        expect(seen.has(k), `${k} 出现在多个集合`).toBe(false);
        seen.add(k);
      }
    }
    // web / unknown 刻意不归类——它们不是法律权威、不是证据、也不是本案事实。
    const unclassified = allKinds.filter((k) => !seen.has(k));
    expect(unclassified).toEqual(["web", "unknown"]);
  });

  it("结论引用案件事实材料时，facts 被填入（不再恒为空）", () => {
    const bundle = makeBundle({
      sources: [
        { id: "src-statute-1", title: "《民法典》第585条", kind: "statute" },
        {
          id: "src-contract-1",
          title: "采购合同第 12 条",
          kind: "contract",
          citation: "采购合同第12条",
        },
        { id: "src-memo-1", title: "案件文件：m-1", kind: "memo" },
      ],
      claims: [
        {
          text: "违约金约定过高应予调减",
          sourceIds: ["src-statute-1", "src-contract-1", "src-memo-1"],
          confidence: 0.9,
          model: "legal",
        },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.issueTree[0]?.facts).toEqual(["采购合同第12条", "案件文件：m-1"]);
    // 权威仍在 authorityIds，未被 facts 抢占
    expect(graph.issueTree[0]?.authorityIds).toEqual(["src-statute-1"]);
  });

  it("web 来源不算案件事实（未经核实的外部资料）", () => {
    const bundle = makeBundle({
      sources: [{ id: "src-web-1", title: "某网站文章", kind: "web" }],
      claims: [
        { text: "违约金应调减", sourceIds: ["src-web-1"], confidence: 0.9, model: "general" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.issueTree[0]?.facts).toEqual([]);
  });

  it("无事实材料来源时 facts 保持空数组（不编造事实）", () => {
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle: makeBundle() });
    const factsTotal = graph.issueTree.reduce((n, i) => n + i.facts.length, 0);
    expect(factsTotal).toBe(0);
  });
});

// ─────────────────────────────────────────────
// 序列化测试
// ─────────────────────────────────────────────

describe("serializeLegalReasoningGraph", () => {
  it("序列化输出包含任务 ID", () => {
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle: makeBundle() });
    const md = serializeLegalReasoningGraph(graph);
    expect(md).toContain("task-001");
  });

  it("序列化输出包含争点标题", () => {
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle: makeBundle() });
    const md = serializeLegalReasoningGraph(graph);
    expect(md).toContain("争点");
  });

  it("序列化输出包含四个章节标题", () => {
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle: makeBundle() });
    const md = serializeLegalReasoningGraph(graph);
    expect(md).toContain("争点树");
    expect(md).toContain("论证矩阵");
    expect(md).toContain("权威冲突");
    expect(md).toContain("交付风险");
  });

  it("空图谱序列化无异常", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent(),
      bundle: makeBundle({ claims: [], sources: [], riskFlags: [], missingItems: [] }),
    });
    const md = serializeLegalReasoningGraph(graph);
    expect(md).toContain("暂无争点");
    expect(md).toContain("未发现显著冲突");
    expect(md).toContain("无额外交付风险标记");
  });

  it("含 matterId 时序列化中体现案件 ID", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent({ matterId: "matter-2024-001" }),
      bundle: makeBundle(),
    });
    const md = serializeLegalReasoningGraph(graph);
    expect(md).toContain("matter-2024-001");
  });
});

// ─────────────────────────────────────────────
// 反序列化 meta 测试
// ─────────────────────────────────────────────

describe("parseLegalReasoningGraphMeta", () => {
  it("能从序列化 Markdown 恢复基础元信息", () => {
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle: makeBundle() });
    const md = serializeLegalReasoningGraph(graph);
    const meta = parseLegalReasoningGraphMeta(md);
    expect(meta).not.toBeNull();
    expect(meta!.taskId).toBe("task-001");
    expect(meta!.overallConfidence).toBeCloseTo((0.92 + 0.85) / 2, 1);
  });

  it("能从序列化 Markdown 恢复 matterId", () => {
    const graph = buildLegalReasoningGraph({
      intent: makeIntent({ matterId: "matter-abc" }),
      bundle: makeBundle(),
    });
    const md = serializeLegalReasoningGraph(graph);
    const meta = parseLegalReasoningGraphMeta(md);
    expect(meta!.matterId).toBe("matter-abc");
  });

  it("无效 Markdown 返回 null", () => {
    expect(parseLegalReasoningGraphMeta("# 随便一段无效文本")).toBeNull();
  });
});
