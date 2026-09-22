import { describe, expect, it } from "vitest";
import type { LegalReasoningGraph, LegalIssueNode } from "../types.js";
import {
  reasoningStructureChecks,
  validateReasoningAgainstSpec,
  validateReasoningForDraft,
} from "./reasoning-validator.js";

function issue(o: Partial<LegalIssueNode> & { issue: string }): LegalIssueNode {
  return {
    elements: ["要件一"],
    facts: ["合同第12条"],
    evidence: ["（2023）京民终12345号"],
    authorityIds: ["a1"],
    openQuestions: [],
    confidence: 0.8,
    ...o,
  };
}

function graph(o?: Partial<LegalReasoningGraph>): LegalReasoningGraph {
  return {
    taskId: "t1",
    issueTree: [issue({ issue: "争点一" })],
    argumentMatrix: [],
    authorityConflicts: [],
    deliveryRisks: [],
    overallConfidence: 0.8,
    builtAt: "2026-09-21T00:00:00.000Z",
    ...o,
  };
}

function check(checks: ReturnType<typeof reasoningStructureChecks>["checks"], key: string) {
  const found = checks.find((c) => c.key === key);
  if (!found) {
    throw new Error(`未找到检查项 ${key}；实际有 ${checks.map((c) => c.key).join("、")}`);
  }
  return found;
}

describe("G3 论证结构核对：五条检查的骨架", () => {
  it("结构良好的图 → 全部通过", () => {
    const { checks, skipped } = reasoningStructureChecks(graph());
    for (const c of checks) {
      expect(c.passed, `${c.key} 不该未通过：${c.hint ?? ""}`).toBe(true);
    }
    // 不给正文引用时，跨「图 ↔ 正文」那条记 skipped，**不判通过**。
    expect(skipped).toEqual(["authorities_cited_in_body"]);
    expect(checks.map((c) => c.key)).not.toContain("authorities_cited_in_body");
  });

  it("**全部检查都是 warning 级**——advisory 先行，不许擅自升 blocker", () => {
    const { checks } = reasoningStructureChecks(
      graph({
        issueTree: [
          issue({
            issue: "空争点",
            facts: [],
            evidence: [],
            elements: [],
            authorityIds: [],
            openQuestions: ["待核"],
          }),
        ],
      }),
    );
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.severity, `${c.key} 不是 warning`).toBe("warning");
    }
  });
});

describe("G3 检查 1：每个争点都有事实或证据", () => {
  it("空争点 → 未通过，且 hint 指出是哪几个", () => {
    const { checks } = reasoningStructureChecks(
      graph({
        issueTree: [
          issue({ issue: "有依据的争点" }),
          issue({ issue: "空争点", facts: [], evidence: [] }),
        ],
      }),
    );
    const c = check(checks, "issues_grounded");
    expect(c.passed).toBe(false);
    expect(c.hint).toContain("空中楼阁");
    expect(c.hint).toContain("空争点");
  });

  it("只有 facts 没有 evidence 也算有依据（两者其一即可）", () => {
    const { checks } = reasoningStructureChecks(
      graph({ issueTree: [issue({ issue: "只有事实", evidence: [] })] }),
    );
    expect(check(checks, "issues_grounded").passed).toBe(true);
  });

  it("不通过不影响 ready（warning 不是 blocker）", () => {
    // letter.demand 的 spec 要求 minIssues=2（既有 blocker），所以给两个争点，
    // 让本用例只观察**结构检查**是否影响 ready。
    const report = validateReasoningAgainstSpec(
      graph({
        issueTree: [
          issue({ issue: "正常争点" }),
          issue({ issue: "空争点", facts: [], evidence: [] }),
        ],
      }),
      "letter.demand",
    );
    expect(report.checks.find((c) => c.key === "min_issues")?.passed).toBe(true);
    expect(report.blockerCount).toBe(0);
    expect(report.warningCount).toBeGreaterThan(0);
    // 结构问题不得让报告不可用——这正是"advisory 先行"的意思。
    expect(report.ready).toBe(true);
  });
});

describe("G3 检查 2：论证矩阵的支撑依据可追溯", () => {
  it("支撑依据不在任何争点的权威列表里 → 未通过", () => {
    const { checks } = reasoningStructureChecks(
      graph({
        argumentMatrix: [
          {
            position: "我方主张",
            supportIds: ["a1", "幽灵来源"],
            likelyCounterarguments: [],
            rebuttals: [],
            evidenceBacked: true,
          },
        ],
      }),
    );
    const c = check(checks, "argument_supports_traced");
    expect(c.passed).toBe(false);
    expect(c.hint).toContain("幽灵来源");
  });

  it("支撑依据都在争点权威里 → 通过", () => {
    const { checks } = reasoningStructureChecks(
      graph({
        argumentMatrix: [
          {
            position: "我方主张",
            supportIds: ["a1"],
            likelyCounterarguments: [],
            rebuttals: [],
            evidenceBacked: true,
          },
        ],
      }),
    );
    expect(check(checks, "argument_supports_traced").passed).toBe(true);
  });

  it("空白支撑 id 不算孤儿（不制造噪声）", () => {
    const { checks } = reasoningStructureChecks(
      graph({
        argumentMatrix: [
          {
            position: "p",
            supportIds: ["", "  "],
            likelyCounterarguments: [],
            rebuttals: [],
            evidenceBacked: false,
          },
        ],
      }),
    );
    expect(check(checks, "argument_supports_traced").passed).toBe(true);
  });
});

describe("G3 检查 3：权威在正文被引用（跨「图 ↔ 正文」）", () => {
  it("给了正文引用 → 产出该检查", () => {
    const { checks, skipped } = reasoningStructureChecks(graph(), {
      bodyCitationIds: new Set(["a1"]),
    });
    expect(skipped).toEqual([]);
    expect(check(checks, "authorities_cited_in_body").passed).toBe(true);
  });

  it("图里用了但正文没引 → 未通过", () => {
    const { checks } = reasoningStructureChecks(graph(), {
      bodyCitationIds: new Set(["别的东西"]),
    });
    const c = check(checks, "authorities_cited_in_body");
    expect(c.passed).toBe(false);
    expect(c.hint).toContain("a1");
  });

  it("**没有正文引用时记 skipped，不得判通过**（拿不到就说不拿不到）", () => {
    const { checks, skipped } = reasoningStructureChecks(graph());
    expect(skipped).toContain("authorities_cited_in_body");
    expect(checks.map((c) => c.key)).not.toContain("authorities_cited_in_body");
  });

  it("报告把 skipped 如实带出（覆盖不完整不得宣称已核对）", () => {
    const report = validateReasoningAgainstSpec(graph(), "letter.demand");
    expect(report.skippedChecks).toEqual(["authorities_cited_in_body"]);
  });

  it("图都没有时 skippedChecks 标 structure:*，不假装结构已核对", () => {
    const report = validateReasoningAgainstSpec(undefined, "letter.demand");
    expect(report.skippedChecks).toEqual(["structure:*"]);
  });

  it("validateReasoningForDraft 会把正文引用传进去（该检查不再 skipped）", () => {
    const report = validateReasoningForDraft(
      {
        taskId: "t1",
        title: "律师函",
        output: "docx",
        templateId: "tpl",
        summary: "s",
        sections: [{ heading: "一", body: "正文", citations: ["a1"] }],
        reviewNotes: [],
        reviewStatus: "pending",
        createdAt: "2026-09-21T00:00:00.000Z",
        deliverableType: "letter.demand",
      },
      graph(),
    );
    expect(report.skippedChecks).toBeUndefined();
    expect(report.checks.map((c) => c.key)).toContain("authorities_cited_in_body");
  });
});

describe("G3 检查 4：IRAC 三级都在", () => {
  it("缺要件 → 未通过", () => {
    const { checks } = reasoningStructureChecks(
      graph({ issueTree: [issue({ issue: "缺要件", elements: [] })] }),
    );
    const c = check(checks, "irac_levels_present");
    expect(c.passed).toBe(false);
    expect(c.hint).toContain("论证链断了一环");
  });

  it("要件与依据都在 → 通过", () => {
    const { checks } = reasoningStructureChecks(graph());
    expect(check(checks, "irac_levels_present").passed).toBe(true);
  });
});

describe("G3 检查 5：openQuestions 非空不得判收敛", () => {
  it("有未决问题 → 未通过，且 hint 引用具体问题", () => {
    const { checks } = reasoningStructureChecks(
      graph({ issueTree: [issue({ issue: "有疑问", openQuestions: ["该条是否已废止"] })] }),
    );
    const c = check(checks, "no_open_questions");
    expect(c.passed).toBe(false);
    expect(c.hint).toContain("该条是否已废止");
    expect(c.hint).toContain("不宜按已收敛交卷");
  });

  it("无未决问题 → 通过", () => {
    const { checks } = reasoningStructureChecks(graph());
    expect(check(checks, "no_open_questions").passed).toBe(true);
  });
});

describe("G3 结构核对不改变既有门禁行为", () => {
  it("既有三条 spec 检查仍在（min_issues / facts_grounded / authority_conflicts_resolved）", () => {
    const report = validateReasoningAgainstSpec(graph(), "letter.demand");
    const keys = report.checks.map((c) => c.key);
    expect(keys).toContain("min_issues");
    expect(keys).toContain("facts_grounded");
    expect(keys).toContain("authority_conflicts_resolved");
  });

  it("结构检查全绿也不会把 P0-4a 的 facts_grounded 变成 blocker", () => {
    // 真实形状：facts 结构性为空（P0-4a 已实测）。
    const report = validateReasoningAgainstSpec(
      graph({
        issueTree: [issue({ issue: "争点一", facts: [] }), issue({ issue: "争点二", facts: [] })],
      }),
      "letter.demand",
    );
    expect(report.checks.find((c) => c.key === "facts_grounded")?.severity).toBe("warning");
    // min_issues 是既有 blocker（spec minIssues=2）；这里两个争点，故不应有 blocker。
    expect(report.blockerCount).toBe(0);
    expect(report.ready).toBe(true);
  });

  it("**结构检查没有削弱既有门禁**：争点不足时 min_issues 仍然 block", () => {
    const report = validateReasoningAgainstSpec(
      graph({ issueTree: [issue({ issue: "只有一个争点" })] }),
      "letter.demand",
    );
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.key === "min_issues")?.severity).toBe("blocker");
  });
});
