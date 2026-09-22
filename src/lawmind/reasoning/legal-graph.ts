/**
 * LegalReasoningGraph — 法律推理图谱
 *
 * 在检索（ResearchBundle）和起草（ArtifactDraft）之间插入显式推理层。
 * 把"模型会写"升级为"系统会推理"，沉淀：
 *   - 争点树（issue tree）
 *   - 论证矩阵（argument matrix）
 *   - 权威冲突列表（authority conflicts）
 *   - 交付风险标记（delivery risks）
 *
 * 生命周期：
 *   ResearchBundle -> buildLegalReasoningGraph() -> LegalReasoningGraph
 *   LegalReasoningGraph -> serializeLegalReasoningGraph() -> Markdown
 *   Markdown -> parseLegalReasoningGraph() -> LegalReasoningGraph（恢复）
 *
 * 构建策略（当前为规则驱动）：
 *   - 每条 ResearchClaim 对应一个候选争点节点
 *   - 高风险 riskFlags 映射为 deliveryRisk + 低置信争点
 *   - 权威冲突：同一来源类型中 confidence 差距 > 0.3 的结论对
 *   - 论证矩阵：每条结论对应一个 ArgumentPosition
 */

import type {
  ArgumentPosition,
  AuthorityConflict,
  LegalIssueNode,
  LegalReasoningGraph,
  ResearchBundle,
  ResearchClaim,
  SourceKind,
  TaskIntent,
} from "../types.js";

// ─────────────────────────────────────────────
// 来源 → IRAC 槽位的映射（单一真相源）
// ─────────────────────────────────────────────

/**
 * 来源 kind 决定它填进争点节点的哪个 IRAC 槽位。**这三个集合互斥且合起来覆盖全部 kind**，
 * 新增 SourceKind 时必须在这里归类，否则会在 `assertSourceKindCoverage()` 处被测试拦住。
 *
 * - `authorityIds` ← 法律规范（法条 / 司法解释）
 * - `evidence`     ← 类案裁判（先例，作为证据）
 * - `facts`        ← 案件事实材料（合同原文 / 工作文件 / 工作区文件）
 */
const AUTHORITY_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "statute",
  "regulation",
]);

const EVIDENCE_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(["case"]);

/**
 * 算作「案件事实」的来源 kind。
 *
 * 刻意**不含** `web`（外部网络资料，未经核实，不是本案事实）与 `unknown`。
 * 类型文档对 `LegalIssueNode.facts` 的定义是「相关事实（来自案件 CASE.md 或检索 bundle）」，
 * 所以 `memo`（含 CASE.md）与 `workspace` 属于此列。
 */
const FACT_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>([
  "contract",
  "memo",
  "workspace",
]);

export const IRAC_SOURCE_KIND_COVERAGE = {
  authority: AUTHORITY_SOURCE_KINDS,
  evidence: EVIDENCE_SOURCE_KINDS,
  facts: FACT_SOURCE_KINDS,
} as const;

// ─────────────────────────────────────────────
// 构建入口
// ─────────────────────────────────────────────

export type BuildLegalGraphParams = {
  intent: TaskIntent;
  bundle: ResearchBundle;
};

/**
 * 从 ResearchBundle 构建 LegalReasoningGraph。
 * 规则驱动实现；未来可替换为 LLM 驱动版本。
 */
export function buildLegalReasoningGraph(params: BuildLegalGraphParams): LegalReasoningGraph {
  const { intent, bundle } = params;

  const issueTree = buildIssueTree(bundle);
  const argumentMatrix = buildArgumentMatrix(bundle);
  const authorityConflicts = detectAuthorityConflicts(bundle);
  const deliveryRisks = buildDeliveryRisks(bundle);

  const overallConfidence =
    issueTree.length > 0
      ? issueTree.reduce((sum, n) => sum + n.confidence, 0) / issueTree.length
      : 0;

  return {
    taskId: intent.taskId,
    matterId: intent.matterId,
    issueTree,
    argumentMatrix,
    authorityConflicts,
    deliveryRisks,
    overallConfidence,
    builtAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// 争点树构建
// ─────────────────────────────────────────────

function buildIssueTree(bundle: ResearchBundle): LegalIssueNode[] {
  if (bundle.claims.length === 0) {
    return [];
  }

  return bundle.claims.map((claim, idx) => {
    const sources = bundle.sources.filter((s) => claim.sourceIds.includes(s.id));
    const statutes = sources.filter((s) => AUTHORITY_SOURCE_KINDS.has(s.kind));
    const cases = sources.filter((s) => EVIDENCE_SOURCE_KINDS.has(s.kind));
    // 案件事实材料：合同原文 / 工作文件 / 工作区文件。
    // 注意：当前只有 `createWorkspaceAdapter` 产出 `memo` / `workspace` 来源，而它
    // `claims: []`——所以这些来源不会被任何 claim 引用，`facts` 在实践中恒为空。
    // 详见 `reasoning-validator.ts` 里 FACTS_GROUNDED_SEVERITY 的说明与升级条件。
    const factSources = sources.filter((s) => FACT_SOURCE_KINDS.has(s.kind));

    return {
      issue: `争点 ${idx + 1}：${claim.text.slice(0, 80)}${claim.text.length > 80 ? "…" : ""}`,
      elements: extractLegalElements(claim),
      facts: factSources.map((s) => s.citation ?? s.title),
      evidence: cases.map((c) => c.citation ?? c.title),
      authorityIds: statutes.map((s) => s.id),
      openQuestions: bundle.missingItems.slice(0, 2),
      confidence: claim.confidence,
    };
  });
}

/**
 * 从结论文本提取法律要件。
 * 当前为启发式规则；后续可替换为 LLM 抽取。
 */
function extractLegalElements(claim: ResearchClaim): string[] {
  const elements: string[] = [];
  // 标注来源模型作为要件维度之一
  elements.push(`来源模型：${claim.model}`);
  // 置信度作为要件充分性提示
  if (claim.confidence < 0.6) {
    elements.push("⚠️ 证据不充分，需补充核实");
  }
  // 若有多个来源，视为具备多方印证
  if (claim.sourceIds.length > 1) {
    elements.push(`多来源印证（${claim.sourceIds.length} 条）`);
  }
  return elements;
}

// ─────────────────────────────────────────────
// 论证矩阵构建
// ─────────────────────────────────────────────

function buildArgumentMatrix(bundle: ResearchBundle): ArgumentPosition[] {
  return bundle.claims.map((claim) => {
    const sources = bundle.sources.filter((s) => claim.sourceIds.includes(s.id));
    const evidenceBacked = sources.some((s) => s.kind === "case" || s.kind === "contract");

    return {
      position: claim.text,
      supportIds: claim.sourceIds,
      likelyCounterarguments: bundle.riskFlags.slice(0, 2).map((r) => `对方可能援引：${r}`),
      rebuttals: [],
      evidenceBacked,
    };
  });
}

// ─────────────────────────────────────────────
// 权威冲突检测
// ─────────────────────────────────────────────

/**
 * 检测**法律主题相同、但依据的权威不同**的结论对，标记为潜在权威冲突。
 *
 * 2026-09-20 修正（P0-4b）：旧实现按「共享同一个 source」判定，把
 * 「两条结论引了同一条法条且置信度差 > 0.3」报成权威冲突。那是**误报**，因为
 * 共享同一条法条时，分歧在**推论**而不在**权威**——报成 authority conflict 会让
 * 律师去翻一条并不矛盾的条文，同时真正的权威冲突（两条不同的法条/类案给出不同结论）
 * 反而没人报。
 *
 * 新判定有两个条件，缺一不可：
 *   1. **同一法律主题**（按结论文本推断的条款类型 / 法律主题键相同）；
 *   2. **依据的权威不同**（两条结论的权威来源集合不相等——同一条法条内的分歧不算）。
 * 仍保留「置信度差 > 0.3」作为显著性门槛，避免把措辞差异报成冲突。
 *
 * `authorityIds` 现在填**两条结论各自的权威来源并集**（而不是原先的「共享来源」），
 * 因为这正是需要律师去权衡的对象。
 */
const AUTHORITY_CONFLICT_CONFIDENCE_GAP = 0.3;

/**
 * 法律主题键的判定表。**这是本地推断，不是法条分类**；只用于把「同一主题」的结论
 * 聚到一起比较，命中不了就退化为按多来源重叠判定（见下）。
 *
 * 刻意与 `clause/dsl.ts` 的条款模式家族保持同名，便于将来统一到条款 AST。
 */
const LEGAL_TOPIC_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "违约金", re: /违约金|惩罚性赔偿|违约金过高|违约金过低/ },
  { id: "定金", re: /定金|订金/ },
  { id: "利率", re: /利率|利息|LPR|贷款市场报价利率/ },
  { id: "管辖", re: /管辖|争议解决|仲裁|人民法院|法院/ },
  { id: "时效", re: /诉讼时效|时效|除斥期间/ },
  { id: "保密", re: /保密|商业秘密|竞业/ },
  { id: "赔偿责任", re: /赔偿责任|责任限制|责任上限|损害赔偿/ },
  { id: "知识产权", re: /知识产权|著作权|商标|专利|许可使用/ },
  { id: "合同解除", re: /解除|撤销|终止/ },
  { id: "保证", re: /保证|担保|抵押|质押/ },
];

/** 结论文本 → 法律主题键；命中不了返回 undefined（不猜）。 */
export function detectLegalTopic(text: string): string | undefined {
  for (const row of LEGAL_TOPIC_PATTERNS) {
    if (row.re.test(text)) {
      return row.id;
    }
  }
  return undefined;
}

/** 两条结论的主题键是否可比较（都识别出主题且相同）。 */
function sameLegalTopic(a: ResearchClaim, b: ResearchClaim): boolean {
  const topicA = detectLegalTopic(a.text);
  if (!topicA) {
    return false;
  }
  return topicA === detectLegalTopic(b.text);
}

function detectAuthorityConflicts(bundle: ResearchBundle): AuthorityConflict[] {
  const conflicts: AuthorityConflict[] = [];
  const claims = bundle.claims;

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      // 条件 1：同一法律主题。主题识别不出就不判——宁缺勿滥（门禁语境下误报代价更高）。
      if (!sameLegalTopic(a, b)) {
        continue;
      }

      // 条件 2：依据的权威不同。共享同一权威时的分歧是推论分歧，不是权威冲突。
      const authorityA = a.sourceIds.filter((id) => !b.sourceIds.includes(id));
      const authorityB = b.sourceIds.filter((id) => !a.sourceIds.includes(id));
      if (authorityA.length === 0 && authorityB.length === 0) {
        continue;
      }

      // 条件 3：显著性——置信度差距够大才值得律师权衡。
      const confidenceGap = Math.abs(a.confidence - b.confidence);
      if (confidenceGap <= AUTHORITY_CONFLICT_CONFIDENCE_GAP) {
        continue;
      }

      const topic = detectLegalTopic(a.text);
      const unioned = [...new Set([...a.sourceIds, ...b.sourceIds])];
      conflicts.push({
        authorityIds: unioned,
        conflict: `同一主题「${topic ?? "未分类"}」上两条结论依据不同权威且置信度差异显著：「${a.text.slice(0, 50)}…」（置信 ${Math.round(a.confidence * 100)}%）与「${b.text.slice(0, 50)}…」（置信 ${Math.round(b.confidence * 100)}%）`,
        resolutionNote: "建议律师人工判断以哪条结论为主",
        resolved: false,
      });
    }
  }

  return conflicts;
}

// ─────────────────────────────────────────────
// 交付风险构建
// ─────────────────────────────────────────────

function buildDeliveryRisks(bundle: ResearchBundle): string[] {
  const risks: string[] = [];

  for (const flag of bundle.riskFlags) {
    risks.push(`起草时应保守表述：${flag}`);
  }
  for (const missing of bundle.missingItems) {
    risks.push(`以下信息缺失，建议在草稿中注明"待确认"：${missing}`);
  }
  // 低置信度结论应在草稿中降低确定性表述
  const lowConf = bundle.claims.filter((c) => c.confidence < 0.5);
  if (lowConf.length > 0) {
    risks.push(`${lowConf.length} 条结论置信度 < 50%，建议在草稿中使用"可能""应予注意"等保守措辞`);
  }

  return risks;
}

// ─────────────────────────────────────────────
// 序列化 / 反序列化（Markdown）
// ─────────────────────────────────────────────

/**
 * 将 LegalReasoningGraph 序列化为人可读的 Markdown，
 * 供律师审阅或写入 MATTER_STRATEGY.md 推理日志节。
 */
export function serializeLegalReasoningGraph(graph: LegalReasoningGraph): string {
  const lines: string[] = [
    `# 法律分析`,
    ``,
    `- **任务 ID**：${graph.taskId}`,
    graph.matterId ? `- **案件 ID**：${graph.matterId}` : "",
    `- **整体置信度**：${Math.round(graph.overallConfidence * 100)}%`,
    `- **生成时间**：${graph.builtAt}`,
    ``,
    `---`,
    ``,
    `## 一、争点树`,
    ``,
  ];

  if (graph.issueTree.length === 0) {
    lines.push("_暂无争点（检索结果为空）_");
  } else {
    for (const node of graph.issueTree) {
      lines.push(`### ${node.issue}`, ``);
      lines.push(`- **置信度**：${Math.round(node.confidence * 100)}%`);
      if (node.elements.length > 0) {
        lines.push(`- **要件**：${node.elements.join("；")}`);
      }
      if (node.authorityIds.length > 0) {
        lines.push(`- **权威来源**：${node.authorityIds.join("，")}`);
      }
      if (node.evidence.length > 0) {
        lines.push(`- **证据支撑**：${node.evidence.join("；")}`);
      }
      if (node.openQuestions.length > 0) {
        lines.push(`- **待确认**：${node.openQuestions.join("；")}`);
      }
      lines.push(``);
    }
  }

  lines.push(`---`, ``, `## 二、论证矩阵`, ``);

  if (graph.argumentMatrix.length === 0) {
    lines.push("_暂无论证_");
  } else {
    for (const pos of graph.argumentMatrix) {
      lines.push(`**我方主张**：${pos.position}`, ``);
      lines.push(`- 证据支撑：${pos.evidenceBacked ? "是" : "否（法律推理）"}`);
      if (pos.likelyCounterarguments.length > 0) {
        lines.push(`- 可能抗辩：${pos.likelyCounterarguments.join("；")}`);
      }
      if (pos.rebuttals.length > 0) {
        lines.push(`- 反驳路径：${pos.rebuttals.join("；")}`);
      }
      lines.push(``);
    }
  }

  lines.push(`---`, ``, `## 三、权威冲突`, ``);

  if (graph.authorityConflicts.length === 0) {
    lines.push("_未发现显著冲突_");
  } else {
    for (const c of graph.authorityConflicts) {
      lines.push(`- **冲突**：${c.conflict}`);
      if (c.resolutionNote) {
        lines.push(`  - 处理建议：${c.resolutionNote}`);
      }
      lines.push(`  - 状态：${c.resolved ? "已解决" : "未解决"}`);
    }
  }

  lines.push(``, `---`, ``, `## 四、交付风险`, ``);

  if (graph.deliveryRisks.length === 0) {
    lines.push("_无额外交付风险标记_");
  } else {
    for (const r of graph.deliveryRisks) {
      lines.push(`- ${r}`);
    }
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

/**
 * 从 Markdown 解析 LegalReasoningGraph（轻量版本，用于恢复持久化内容）。
 * 只提取 taskId、matterId、overallConfidence、builtAt，
 * 复杂的结构化字段留空（Markdown 往返损耗是可接受权衡）。
 */
export function parseLegalReasoningGraphMeta(
  markdown: string,
): Pick<LegalReasoningGraph, "taskId" | "matterId" | "overallConfidence" | "builtAt"> | null {
  const taskIdMatch = markdown.match(/\*\*任务 ID\*\*：(.+)/);
  const matterIdMatch = markdown.match(/\*\*案件 ID\*\*：(.+)/);
  const confMatch = markdown.match(/\*\*整体置信度\*\*：(\d+)%/);
  const builtAtMatch = markdown.match(/\*\*生成时间\*\*：(.+)/);

  if (!taskIdMatch) {
    return null;
  }

  return {
    taskId: taskIdMatch[1].trim(),
    matterId: matterIdMatch?.[1].trim(),
    overallConfidence: confMatch ? parseInt(confMatch[1], 10) / 100 : 0,
    builtAt: builtAtMatch?.[1].trim() ?? new Date().toISOString(),
  };
}
