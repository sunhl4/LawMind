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

  it("检测共享来源且置信度差 > 0.3 的权威冲突", () => {
    const bundle = makeBundle({
      claims: [
        { text: "结论 A", sourceIds: ["src-statute-1"], confidence: 0.9, model: "legal" },
        { text: "结论 B", sourceIds: ["src-statute-1"], confidence: 0.5, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.authorityConflicts).toHaveLength(1);
    expect(graph.authorityConflicts[0].authorityIds).toContain("src-statute-1");
    expect(graph.authorityConflicts[0].resolved).toBe(false);
  });

  it("置信度差 <= 0.3 时不产生冲突", () => {
    const bundle = makeBundle({
      claims: [
        { text: "结论 A", sourceIds: ["src-statute-1"], confidence: 0.9, model: "legal" },
        { text: "结论 B", sourceIds: ["src-statute-1"], confidence: 0.65, model: "legal" },
      ],
    });
    const graph = buildLegalReasoningGraph({ intent: makeIntent(), bundle });
    expect(graph.authorityConflicts).toHaveLength(0);
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
