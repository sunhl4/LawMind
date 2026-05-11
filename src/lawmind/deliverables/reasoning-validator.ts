/**
 * Reasoning Gate validator — W9。
 *
 * 输入：LegalReasoningGraph + DeliverableSpec.reasoningGate
 * 输出：ReasoningReport（与 AcceptanceReport 形态对齐，便于桌面 UI 同列展示）
 *
 * 设计原则：
 *   - 仅当 spec.reasoningGate?.required === true 时报告 `required: true`。
 *   - 报告始终包含每条规则的 check 结果，UI 可据此渲染勾选清单。
 *   - 与 acceptance gate 不重复：reasoning 关注"思考过程"，acceptance 关注"成品结构"。
 */

import type { ArtifactDraft, DeliverableType, LegalReasoningGraph } from "../types.js";
import { getDeliverableSpec } from "./registry.js";
import type {
  DeliverableSpec,
  ReasoningCheck,
  ReasoningGateSpec,
  ReasoningReport,
} from "./types.js";

const DEFAULT_MIN_ISSUES = 1;
const DEFAULT_MIN_FACTS = 0;

export type ValidateReasoningOptions = {
  /** 显式指定 spec（不传时按 deliverableType / draft.deliverableType 查询） */
  spec?: DeliverableSpec;
};

/**
 * 校验推理图谱是否满足 spec.reasoningGate。
 *
 * 当 spec 未指定 reasoningGate 或 required=false：返回 ready=true / required=false（仅信息性）。
 */
export function validateReasoningAgainstSpec(
  graph: LegalReasoningGraph | undefined,
  deliverableType: DeliverableType | undefined,
  opts?: ValidateReasoningOptions,
): ReasoningReport {
  const spec = opts?.spec ?? getDeliverableSpec(deliverableType);
  const gate: ReasoningGateSpec | undefined = spec?.reasoningGate;
  const required = gate?.required === true;
  const minIssues = gate?.minIssues ?? DEFAULT_MIN_ISSUES;
  const minFacts = gate?.minFacts ?? DEFAULT_MIN_FACTS;
  const mustResolveAuthorityConflicts = gate?.mustResolveAuthorityConflicts === true;

  const checks: ReasoningCheck[] = [];

  if (!graph) {
    checks.push({
      key: "graph_present",
      label: "推理图谱已生成",
      passed: false,
      severity: required ? "blocker" : "warning",
      hint: "未发现 reasoning snapshot；请确认 engine 已为该任务构建 LegalReasoningGraph。",
    });
    const blockerCount = checks.filter((c) => !c.passed && c.severity === "blocker").length;
    const warningCount = checks.filter((c) => !c.passed && c.severity === "warning").length;
    return {
      taskId: "(unknown)",
      deliverableType,
      ready: !required || blockerCount === 0,
      required,
      checks,
      blockerCount,
      warningCount,
      generatedAt: new Date().toISOString(),
    };
  }

  // 1. 至少 N 个争点
  const issueCount = graph.issueTree.length;
  checks.push({
    key: "min_issues",
    label: `至少包含 ${minIssues} 个争点（当前 ${issueCount}）`,
    passed: issueCount >= minIssues,
    severity: required ? "blocker" : "warning",
    hint: issueCount >= minIssues ? undefined : `请补足争点拆解：当前 ${issueCount}/${minIssues}。`,
  });

  // 2. 每个争点至少有事实或证据
  const factsTotal = graph.issueTree.reduce((sum, n) => sum + n.facts.length, 0);
  checks.push({
    key: "facts_grounded",
    label: `争点合计事实数 ≥ ${minFacts}（当前 ${factsTotal}）`,
    passed: factsTotal >= minFacts,
    severity: required ? "warning" : "warning",
    hint: factsTotal >= minFacts ? undefined : "争点缺少事实支撑，存在'空中楼阁'风险。",
  });

  // 3. 权威冲突解决
  const unresolvedAuthorityConflicts = graph.authorityConflicts.filter((c) => !c.resolved);
  checks.push({
    key: "authority_conflicts_resolved",
    label: "权威冲突已全部解决",
    passed: !mustResolveAuthorityConflicts || unresolvedAuthorityConflicts.length === 0,
    severity: mustResolveAuthorityConflicts ? "blocker" : "warning",
    hint:
      unresolvedAuthorityConflicts.length === 0
        ? undefined
        : `仍有 ${unresolvedAuthorityConflicts.length} 处权威冲突未解决，请在 reasoning graph 中给出 resolutionNote。`,
  });

  // 4. 每个争点至少声明一个 authority（authorityIds）
  const issuesWithoutAuthority = graph.issueTree.filter((n) => n.authorityIds.length === 0);
  checks.push({
    key: "issues_have_authority",
    label: "每个争点都引用至少一个权威",
    passed: issuesWithoutAuthority.length === 0,
    severity: required ? "warning" : "warning",
    hint:
      issuesWithoutAuthority.length === 0
        ? undefined
        : `${issuesWithoutAuthority.length} 个争点未引用权威，请补充 authorityIds。`,
  });

  // 5. 整体置信度合理（必须门禁开启时不可低于 0.4）
  const confidenceOk = !required || graph.overallConfidence >= 0.4;
  checks.push({
    key: "confidence_ok",
    label: `整体推理置信度（当前 ${graph.overallConfidence.toFixed(2)}）`,
    passed: confidenceOk,
    severity: required ? "warning" : "warning",
    hint: confidenceOk
      ? undefined
      : "整体推理置信度过低（< 0.40），建议先解决 openQuestions 再渲染。",
  });

  const blockerCount = checks.filter((c) => !c.passed && c.severity === "blocker").length;
  const warningCount = checks.filter((c) => !c.passed && c.severity === "warning").length;

  return {
    taskId: graph.taskId,
    deliverableType,
    ready: !required || blockerCount === 0,
    required,
    checks,
    blockerCount,
    warningCount,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 便利函数：根据 ArtifactDraft + reasoning snapshot 校验。
 * 由 engine/rendering.ts 调用（strict 模式合并 acceptance + reasoning 双门禁）。
 */
export function validateReasoningForDraft(
  draft: ArtifactDraft,
  graph: LegalReasoningGraph | undefined,
): ReasoningReport {
  return validateReasoningAgainstSpec(graph, draft.deliverableType);
}
