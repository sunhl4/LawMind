import { describe, expect, it } from "vitest";
import { triageAgainstPlaybook, type Playbook } from "../deliverables/playbook-triage.js";
import {
  buildDecisionHeader,
  collectUnverifiedSignals,
  formatUnverifiedSection,
  resolveDecisionHeader,
  toDecisionPlaybookSummary,
} from "./decision-header.js";

const cleanLint = {
  blockerCount: 0,
  warningCount: 0,
  summaryZh: "机械核对未见已知缺陷。",
};

describe("buildDecisionHeader", () => {
  it("marks usable when low risk and lint is clean", () => {
    const h = buildDecisionHeader({
      title: "保密协议",
      lint: cleanLint,
      riskLevel: "low",
    });
    expect(h.changed).toContain("保密协议");
    expect(h.why).toContain("审阅");
    expect(h.risk).toContain("通过核对 ≠ 法律正确");
    expect(h.ready).toBe("usable");
  });

  it("is honest when lint still has blockers", () => {
    const h = buildDecisionHeader({
      title: "买卖合同",
      lint: { blockerCount: 2, warningCount: 1, summaryZh: "2 项须处理" },
      riskLevel: "low",
    });
    expect(h.ready).toBe("needs_decision");
    expect(h.risk).toContain("2 项须处理");
    expect(h.risk).toContain("通过核对 ≠ 法律正确");
  });

  it("requires a decision for high and medium risk even if lint is clean", () => {
    expect(buildDecisionHeader({ title: "起诉状", lint: cleanLint, riskLevel: "high" }).ready).toBe(
      "needs_decision",
    );
    expect(
      buildDecisionHeader({ title: "备忘录", lint: cleanLint, riskLevel: "medium" }).ready,
    ).toBe("needs_decision");
    expect(
      buildDecisionHeader({ title: "起诉状", lint: cleanLint, riskLevel: "high" }).risk,
    ).toContain("高风险");
  });

  it("mentions self-revise fixes and residual subjective items", () => {
    const h = buildDecisionHeader({
      title: "劳动合同",
      lint: cleanLint,
      riskLevel: "low",
      selfRevise: {
        rounds: 2,
        appliedCount: 3,
        appliedSummaries: ["补全占位", "统一主体称谓"],
        residualCount: 1,
        residualSummaries: ["违约金是否过高"],
      },
    });
    expect(h.changed).toContain("补全占位");
    expect(h.why).toContain("主观裁量");
    expect(h.ready).toBe("needs_decision");
  });

  it("uses appliedCount when summaries are empty", () => {
    const h = buildDecisionHeader({
      title: "通知函",
      lint: cleanLint,
      riskLevel: "low",
      selfRevise: { appliedCount: 2, rounds: 1, residualCount: 0 },
    });
    expect(h.changed).toContain("2 处");
    expect(h.ready).toBe("usable");
  });
});

describe("resolveDecisionHeader", () => {
  it("prefers a persisted header when complete", () => {
    const persisted = {
      changed: "只改了送达地址",
      why: "与原合同对齐",
      risk: "低",
      ready: "usable" as const,
    };
    const h = resolveDecisionHeader({
      persisted,
      title: "忽略",
      lint: { blockerCount: 4, warningCount: 0, summaryZh: "x" },
    });
    expect(h.changed).toBe(persisted.changed);
    expect(h.why).toBe(persisted.why);
    expect(h.risk).toBe(persisted.risk);
    expect(h.ready).toBe(persisted.ready);
  });

  it("overlays unverified onto a persisted four-line header", () => {
    const persisted = {
      changed: "只改了送达地址",
      why: "与原合同对齐",
      risk: "低",
      ready: "usable" as const,
    };
    const h = resolveDecisionHeader({
      persisted,
      title: "忽略",
      lint: cleanLint,
      unverified: { pending: ["引用未核（无检索快照）"] },
    });
    expect(h.changed).toBe(persisted.changed);
    expect(h.unverified).toContain("引用未核");
  });

  it("falls back to the builder when persisted is incomplete", () => {
    const h = resolveDecisionHeader({
      persisted: { changed: "x" },
      title: "顾问合同",
      lint: { blockerCount: 1, warningCount: 0, summaryZh: "x" },
    });
    expect(h.ready).toBe("needs_decision");
    expect(h.changed).toContain("顾问合同");
  });
});

describe("formatUnverifiedSection / collectUnverifiedSignals", () => {
  it("omits the section when there is nothing to report", () => {
    expect(formatUnverifiedSection(undefined)).toBeUndefined();
    expect(formatUnverifiedSection({ skipped: [], pending: [] })).toBeUndefined();
    expect(collectUnverifiedSignals({})).toBeUndefined();
  });

  it("distinguishes unread from pending", () => {
    expect(
      formatUnverifiedSection({ unread: ["独立审稿结果"], pending: ["引用未核（无检索快照）"] }),
    ).toMatch(/读不到[\s\S]*待决/);
  });

  it("collects reasoning skips and citation gaps", () => {
    const signals = collectUnverifiedSignals({
      reasoningSkippedChecks: ["structure:*"],
      citation: { checked: false, reason: "no_research_snapshot" },
      guardian: { verdict: "skipped", skipReason: "配额用尽" },
    });
    expect(signals?.skipped?.some((s) => s.includes("论证结构"))).toBe(true);
    expect(signals?.skipped?.some((s) => s.includes("独立审稿"))).toBe(true);
    expect(signals?.pending).toContain("引用未核（无检索快照）");
  });
});

const triagePlaybook: Playbook = {
  id: "prc.contract.general",
  name: "中国法合同审查（通用）",
  jurisdiction: "PRC",
  version: "1.0.0",
  stance: "偏委托方",
  acceptableRange: "责任上限不低于合同金额。",
  escalationTriggers: ["行政处罚"],
  criteria: [
    { id: "dispute_clause", kind: "green", title: "有争议解决条款" },
    { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
  ],
};

const evidence = (quote: string, locator: string) => ({ quote, locator });

describe("decision header playbook block", () => {
  it("surfaces a RED verdict with the non-pass items and their locators", () => {
    const triage = triageAgainstPlaybook({
      playbook: triagePlaybook,
      observations: [
        { criterionId: "dispute_clause", result: "PASS", evidence: evidence("提交仲裁。", "L8") },
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: evidence("乙方承担无限责任。", "L12"),
          reasonZh: "出现无限责任表述。",
        },
      ],
    });
    const header = buildDecisionHeader({
      title: "服务合同",
      lint: cleanLint,
      riskLevel: "low",
      playbook: triage,
    });
    expect(header.ready).toBe("needs_decision");
    expect(header.risk).toContain("剧本判定 RED");
    expect(header.playbook).toMatchObject({
      verdict: "RED",
      basis: "playbook",
      playbookName: "中国法合同审查（通用）",
      counts: { pass: 1, flag: 0, fail: 1 },
    });
    expect(header.playbook?.items).toEqual([
      expect.objectContaining({ title: "不得约定无限责任", result: "FAIL", locator: "L12" }),
    ]);
  });

  it("keeps a GREEN verdict out of the risk line and marks the draft usable", () => {
    const triage = triageAgainstPlaybook({
      playbook: triagePlaybook,
      observations: [
        { criterionId: "dispute_clause", result: "PASS", evidence: evidence("提交仲裁。", "L8") },
        {
          criterionId: "unlimited_liability",
          result: "PASS",
          evidence: evidence("赔偿不超过合同金额。", "L5"),
        },
      ],
    });
    const header = buildDecisionHeader({
      title: "服务合同",
      lint: cleanLint,
      riskLevel: "low",
      playbook: triage,
    });
    expect(header.ready).toBe("usable");
    expect(header.risk).not.toContain("剧本判定 RED");
    expect(header.playbook?.verdict).toBe("GREEN");
    expect(header.playbook?.items).toEqual([]);
  });

  it("states basis=default when no playbook was loaded", () => {
    const triage = triageAgainstPlaybook({ playbook: null });
    const summary = toDecisionPlaybookSummary(triage);
    expect(summary.basis).toBe("default");
    expect(summary.verdict).toBe("YELLOW");
    expect(summary.items).toEqual([]);
  });

  it("replaces a persisted playbook block only when a live triage is supplied", () => {
    const persisted = {
      changed: "起草了「服务合同」",
      why: "按任务要求整理草稿。",
      risk: "机械核对未见已知缺陷。通过核对 ≠ 法律正确。",
      ready: "usable" as const,
      playbook: {
        verdict: "YELLOW" as const,
        basis: "playbook" as const,
        counts: { pass: 0, flag: 1, fail: 0 },
        items: [{ title: "有争议解决条款", result: "FLAG" as const, reasonZh: "未核对" }],
      },
    };
    const kept = resolveDecisionHeader({ persisted, title: "服务合同", lint: cleanLint });
    expect(kept.playbook).toEqual(persisted.playbook);

    const live = triageAgainstPlaybook({
      playbook: triagePlaybook,
      observations: [
        { criterionId: "dispute_clause", result: "PASS", evidence: evidence("提交仲裁。", "L8") },
        {
          criterionId: "unlimited_liability",
          result: "PASS",
          evidence: evidence("赔偿不超过合同金额。", "L5"),
        },
      ],
    });
    const replaced = resolveDecisionHeader({
      persisted,
      title: "服务合同",
      lint: cleanLint,
      playbook: live,
    });
    expect(replaced.playbook?.verdict).toBe("GREEN");
  });
});
