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
  TaskIntent,
} from "../types.js";

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
    const statutes = sources.filter((s) => s.kind === "statute" || s.kind === "regulation");
    const cases = sources.filter((s) => s.kind === "case");

    return {
      issue: `争点 ${idx + 1}：${claim.text.slice(0, 80)}${claim.text.length > 80 ? "…" : ""}`,
      elements: extractLegalElements(claim),
      facts: [],
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
 * 检测同一来源类型中置信度差距较大的结论对，标记为潜在权威冲突。
 * 阈值：同类型来源下，两条结论置信度差 > 0.3。
 */
function detectAuthorityConflicts(bundle: ResearchBundle): AuthorityConflict[] {
  const conflicts: AuthorityConflict[] = [];
  const claims = bundle.claims;

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];
      // 共享来源且置信度差异较大 → 潜在矛盾
      const sharedSourceIds = a.sourceIds.filter((id) => b.sourceIds.includes(id));
      if (sharedSourceIds.length > 0 && Math.abs(a.confidence - b.confidence) > 0.3) {
        conflicts.push({
          authorityIds: sharedSourceIds,
          conflict: `结论"${a.text.slice(0, 50)}…"（置信 ${Math.round(a.confidence * 100)}%）与"${b.text.slice(0, 50)}…"（置信 ${Math.round(b.confidence * 100)}%）基于相同来源但置信度差异显著`,
          resolutionNote: "建议律师人工判断以哪条结论为主",
          resolved: false,
        });
      }
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
    `# 法律推理图谱`,
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
