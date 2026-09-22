/**
 * Reasoning Gate validator — W9。
 *
 * Renderer-safe: no Node builtins. Workspace sidecar reads live in
 * `reasoning-validator-workspace.ts`.
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

/**
 * `facts_grounded` 的严重级别——**刻意不设为 blocker**（P0-4a，2026-09-20 复核）。
 *
 * 与 `min_issues` / `authority_conflicts_resolved` 的 `required ? "blocker" : "warning"`
 * 不同，这里**不能**跟着写成 blocker。原因不是疏忽，而是 `facts` 在当前数据形状下
 * **结构上必然为空**（已实测，非推测）：
 *
 *   1. `buildLegalReasoningGraph({ intent, bundle })` 的签名里**没有案件事实**——
 *      `LegalIssueNode.facts` 的类型文档写的是「来自案件 CASE.md 或检索 bundle」，
 *      但函数拿不到 CASE.md。
 *   2. bundle 里唯一的「案件事实」来源是 `memo`（← CASE.md）与 `workspace`
 *      （← CLIENT_PROFILE），二者都由 `createWorkspaceAdapter` 产出——
 *      而该适配器返回 `claims: []`，**不产生任何结论**。
 *   3. `buildIssueTree` 只从 `claim.sourceIds` 反查 sources，所以这些来源永远不会被引用。
 *   4. 会产生结论的适配器（model-adapters / brave-web / url-dossier）只发
 *      `statute` / `web`（见 `model-adapters.ts` 的 `toSources`）。
 *
 * 因此 `factsTotal` 恒为 0。**2026-09-22 用真实工作区实测确认**（136 份 `drafts/*.reasoning.json`）：
 *
 * | 快照 | 数量 | 说明 |
 * | -------------------- | ---- | ------------------------------------------------------------ |
 * | 争点数为 0           | 117（**86%**） | `bundle.claims` 为空 → `buildIssueTree` 直接返回 `[]` |
 * | 争点数 > 0           | 19   | 有 claim 才有争点树 |
 * | ↳ 其中 `facts` > 0   | **0**  | 本项所述的结构性缺口 |
 * | ↳ 其中 `evidence` > 0 | **0** | 另一条同样空转：`evidence` 来自 `case` 类来源，而类案库未接（`caseLaw.ready: false`） |
 *
 * 也就是说：**这一层在真实使用中基本是惰性的**（86% 连争点树都没有），
 * 而 `facts` / `evidence` 两个槽位在每个有争点的快照里都是空的。
 * 检查本身**如实报告**（warning + 可诊断 hint），所以不是"假绿"；但它也**测不出任何东西**。
 *
 * 而 `acceptanceGateStrict` 在 solo / firm / private_deploy
 * **三档都默认开启**（`policy/edition.ts:36`），所以一旦升为 blocker，
 * 所有 `minFacts >= 1` 的高危 spec（letter.* / litigation.* / contract.review）
 * 会在**所有 edition 下必然拦截渲染**——那是回归，不是修复。
 *
 * 升级为前提条件（满足任一即可把它改成 `required ? "blocker" : "warning"`）：
 *   a. 某适配器开始产出**并被结论引用** `contract` / `memo` / `workspace` 类来源；或
 *   b. `buildLegalReasoningGraph` 通过新增的 `caseFacts` 入参拿到案件事实。
 * 届时必须同时补一条端到端断言：真实 bundle → `factsTotal >= 2` → 双门禁通过。
 *
 * 在那之前，本检查**仍然如实报告**（warning），且 hint 会区分「结论没引事实材料」
 * 与「检索根本没返回事实材料」——见 `factsGroundedHint()`。
 */
const FACT_GROUNDED_SEVERITY_FOR_REQUIRED_SPECS: ReasoningCheck["severity"] = "warning";

/**
 * `facts_grounded` 未通过时的提示。
 *
 * 分两种情况，因为它们指向**不同的**修复方向，律师/工程看到的东西应当不同：
 *   - `factsTotal === 0`：一条事实都没落入争点。当前这**通常不是本次稿件的问题**，
 *     而是检索层的结构性缺口（见 FACT_GROUNDED_SEVERITY_FOR_REQUIRED_SPECS 的说明）——
 *     所以文案必须说清楚，不能让律师以为是自己材料没给。
 *   - `0 < factsTotal < minFacts`：确有事实但不够，属于本案材料不足，应由律师补料。
 */
export function factsGroundedHint(factsTotal: number, minFacts: number): string {
  if (factsTotal === 0) {
    return (
      "争点尚未落入任何案件事实材料（合同原文 / 工作文件 / 工作区文件），存在'空中楼阁'风险。" +
      "注：当前检索层不产出被结论引用的案件事实来源，因此本项在多数任务上恒为 0——" +
      "它反映的是结构性缺口，不代表本次稿件有质量问题。请以人工核对材料为准。"
    );
  }
  return `争点事实数不足（当前 ${factsTotal}，需 ≥ ${minFacts}）：请补充案件事实材料或让结论引用已有材料。`;
}

export type ValidateReasoningOptions = {
  /** 显式指定 spec（不传时按 deliverableType / draft.deliverableType 查询） */
  spec?: DeliverableSpec;
  /**
   * G3：论证**结构**核对的上下文。
   *
   * 缺省时结构核对里「依赖正文引用」的那一条会记入 `skippedChecks` 而不是判通过——
   * 拿不到就说不拿不到，不把「没核对」显示成「核对通过」。
   */
  structure?: ReasoningStructureContext;
};

/**
 * G3：论证结构核对的输入。
 *
 * 对应学术上的「结构保证」这一半——`Closing the Loop`（arXiv 2606.23913v1）把法律
 * 推理分成两块：**计算性部分给可证明正确性，open-textured 部分给结构保证**。
 * 本仓拿不到前者（没有 λlaw / Z3），但后者**全是图上已有的集合与可达性运算**：
 * 「这次论证的骨架完整吗」，而不是「结论对不对」。
 */
export type ReasoningStructureContext = {
  /**
   * 正文实际引用的来源 ID 集合（来自 `draft.sections[].citations`）。
   *
   * 用于跨「图 ↔ 正文」核对：图里当作依据的权威，正文里是否真的引了。
   */
  bodyCitationIds?: ReadonlySet<string>;
};

/** P1-A：草稿阶段是否必须附带 LegalReasoningGraph 侧车。 */
export function specRequiresReasoningGraphAtDraft(spec?: DeliverableSpec): boolean {
  const gate = spec?.reasoningGate;
  if (!gate) {
    return false;
  }
  if (gate.requiresReasoningGraphAtDraft !== undefined) {
    return gate.requiresReasoningGraphAtDraft;
  }
  return gate.required;
}

export type ReasoningGraphAtDraftReport = {
  taskId: string;
  deliverableType?: DeliverableType;
  required: boolean;
  ready: boolean;
  hasSnapshot: boolean;
  hint?: string;
  generatedAt: string;
};

/**
 * G3：论证**结构**核对（五条）。
 *
 * 与上面三条 spec 驱动检查的区别：那三条问「稿子够不够格」，这里问
 * **「这次论证的骨架完整吗」**。全部是 `LegalReasoningGraph` 上的集合运算，
 * 不涉及法律结论——所以它们**不能**被当成质量分（`reasoning/` 的既有口径）。
 *
 * 五条：
 *   1. 每个争点至少有事实或证据（空争点 = 骨架缺一级）
 *   2. 论证矩阵的支撑依据都能在争点树上找到（内部一致性，防"装饰性引用"）
 *   3. 争点引用的权威在**正文**里真的被引了（跨"图 ↔ 正文"，需上下文）
 *   4. `issue → elements → fact/evidence` 三级都在（缺级 = 结构缺口）
 *   5. `openQuestions` 非空时不得判收敛
 *
 * **severity 纪律**：新增检查一律先 `warning`（advisory 先行）。
 * 只有过真实数据的 precision 抽审，才允许升 `blocker`——这条继承 P0-4a 的方法论：
 * *Wrong params are worse than no lint*（`lint/statute-params.ts`），
 * 而误报会伤害信任（路线图 R2，等级高）。
 */
export function reasoningStructureChecks(
  graph: LegalReasoningGraph,
  ctx?: ReasoningStructureContext,
): { checks: ReasoningCheck[]; skipped: string[] } {
  const checks: ReasoningCheck[] = [];
  const skipped: string[] = [];

  // 1. 每个争点至少有事实或证据 —— 空争点是没有内容的骨架。
  const emptyIssues = graph.issueTree.filter(
    (n) => n.facts.length === 0 && n.evidence.length === 0,
  );
  checks.push({
    key: "issues_grounded",
    label: `每个争点都有事实或证据（${graph.issueTree.length - emptyIssues.length}/${graph.issueTree.length}）`,
    passed: emptyIssues.length === 0,
    severity: "warning",
    hint:
      emptyIssues.length === 0
        ? undefined
        : `${emptyIssues.length} 个争点既无事实也无证据，属"空中楼阁"：${emptyIssues
            .slice(0, 3)
            .map((n) => n.issue.slice(0, 24))
            .join("、")}。`,
  });

  // 2. 论证矩阵的支撑依据能在争点树上找到 —— 防"装饰性引用"。
  const knownAuthorities = new Set(graph.issueTree.flatMap((n) => n.authorityIds));
  const orphanSupports = [
    ...new Set(
      graph.argumentMatrix
        .flatMap((p) => p.supportIds)
        .filter((id) => id.trim() && !knownAuthorities.has(id)),
    ),
  ];
  checks.push({
    key: "argument_supports_traced",
    label: "论证矩阵的支撑依据都能对应到争点",
    passed: orphanSupports.length === 0,
    severity: "warning",
    hint:
      orphanSupports.length === 0
        ? undefined
        : `有 ${orphanSupports.length} 条支撑依据不在任何争点的权威列表里，无法追溯：${orphanSupports
            .slice(0, 3)
            .join("、")}。`,
  });

  // 3. 争点引用的权威在正文里真的被引了（跨"图 ↔ 正文"）。
  const bodyIds = ctx?.bodyCitationIds;
  if (!bodyIds) {
    // 拿不到正文引用就**不判**——记 skipped，而不是判通过。
    skipped.push("authorities_cited_in_body");
  } else {
    const uncited = [
      ...new Set(
        graph.issueTree
          .flatMap((n) => n.authorityIds)
          .filter((id) => id.trim())
          .filter((id) => !bodyIds.has(id)),
      ),
    ];
    checks.push({
      key: "authorities_cited_in_body",
      label: "争点依据的权威已在正文引用",
      passed: uncited.length === 0,
      severity: "warning",
      hint:
        uncited.length === 0
          ? undefined
          : `有 ${uncited.length} 条依据只在分析里出现、正文未引用：${uncited.slice(0, 3).join("、")}。结论可能缺乏对应引用。`,
    });
  }

  // 4. issue → elements → fact/evidence 三级是否都在（缺级 = 结构缺口）。
  const missingLevel = graph.issueTree.filter(
    (n) => n.elements.length === 0 || (n.facts.length === 0 && n.evidence.length === 0),
  );
  checks.push({
    key: "irac_levels_present",
    label: "争点均具备要件与依据两级",
    passed: missingLevel.length === 0,
    severity: "warning",
    hint:
      missingLevel.length === 0
        ? undefined
        : `${missingLevel.length} 个争点缺少要件拆解或依据之一，论证链断了一环。`,
  });

  // 5. openQuestions 非空时不得判收敛。
  const openIssues = graph.issueTree.filter((n) => n.openQuestions.length > 0);
  checks.push({
    key: "no_open_questions",
    label: "各争点无遗留未决问题",
    passed: openIssues.length === 0,
    severity: "warning",
    hint:
      openIssues.length === 0
        ? undefined
        : `${openIssues.length} 个争点仍列出未决问题，本次不宜按已收敛交卷：${openIssues
            .slice(0, 2)
            .flatMap((n) => n.openQuestions.slice(0, 1))
            .join("、")}。`,
  });

  return { checks, skipped };
}

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
      label: "法律分析已生成",
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
      // 图都没有，结构核对整体没跑——如实登记。
      skippedChecks: ["structure:*"],
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
  const factsPassed = factsTotal >= minFacts;
  checks.push({
    key: "facts_grounded",
    label: `争点合计事实数 ≥ ${minFacts}（当前 ${factsTotal}）`,
    passed: factsPassed,
    severity: required ? FACT_GROUNDED_SEVERITY_FOR_REQUIRED_SPECS : "warning",
    hint: factsPassed ? undefined : factsGroundedHint(factsTotal, minFacts),
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

  // 6.（G3）论证**结构**五条 —— 只给结构保证，不给正确性判断。
  const structure = reasoningStructureChecks(graph, opts?.structure);
  checks.push(...structure.checks);

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
    ...(structure.skipped.length > 0 ? { skippedChecks: structure.skipped } : {}),
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
  // G3：把正文引用传进结构核对（跨「图 ↔ 正文」那条检查需要它）。
  const bodyCitationIds = new Set(
    draft.sections
      .flatMap((s) => s.citations ?? [])
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return validateReasoningAgainstSpec(graph, draft.deliverableType, {
    structure: { bodyCitationIds },
  });
}
