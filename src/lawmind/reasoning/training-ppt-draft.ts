/**
 * Training PPT section builders (ppt.training) + template variant selection.
 */

import {
  assertTrainingDesensitizeGate,
  redactTrainingText,
} from "../research/desensitize-matter.js";
import { expandApprovedOutlineToSections } from "../research/outline-expand.js";
import {
  buildResearchOutline,
  formatOutlineMarkdown,
  type ResearchOutline,
} from "../research/research-outline.js";
import type { ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

export type TrainingDeckVariant =
  | "trainingCle"
  | "crossborderMatrix"
  | "internalKnowledge"
  | "caseClinic";

function placeholder(label: string): string {
  return `【${label}】`;
}

function haystack(intent: TaskIntent): string {
  return `${intent.instruction ?? ""} ${intent.summary ?? ""}`;
}

export function inferTrainingDeckVariant(intent: TaskIntent): TrainingDeckVariant {
  const text = haystack(intent);
  if (/诊所|案件带教|脱敏案例|matter|本案/.test(text)) {
    return "caseClinic";
  }
  if (/跨境|涉外|管辖|比较法|欧盟|美国|香港/.test(text)) {
    return "crossborderMatrix";
  }
  if (/所内|内部|合伙人会|知识分享/.test(text)) {
    return "internalKnowledge";
  }
  return "trainingCle";
}

export function trainingTemplateIdForVariant(variant: TrainingDeckVariant): string {
  switch (variant) {
    case "crossborderMatrix":
      return "ppt/crossborder-matrix-default";
    case "internalKnowledge":
      return "ppt/internal-knowledge-default";
    case "caseClinic":
      return "ppt/case-clinic-default";
    default:
      return "ppt/training-cle-default";
  }
}

export function inferTrainingTitle(intent: TaskIntent): string {
  const trimmed = intent.summary?.trim();
  if (trimmed && trimmed.length <= 80) {
    return trimmed;
  }
  const m = haystack(intent).match(/主题[是为：:]\s*([^\n。]{2,60})/);
  if (m?.[1]) {
    return m[1].trim();
  }
  return "培训课件";
}

function claimBullets(bundle: ResearchBundle, limit = 5): string {
  if (bundle.claims.length === 0) {
    return `- ${placeholder("要点一")}\n- ${placeholder("要点二")}\n- ${placeholder("要点三")}`;
  }
  return bundle.claims
    .slice(0, limit)
    .map(
      (c) =>
        `- ${c.text.slice(0, 160)}${c.sourceIds.length ? ` 〔${c.sourceIds.join(",")}〕` : ""}`,
    )
    .join("\n");
}

export function buildTrainingPptSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
  approvedOutline?: ResearchOutline | null,
): ArtifactSection[] {
  const variant = inferTrainingDeckVariant(intent);
  const outline =
    approvedOutline?.status === "approved"
      ? approvedOutline
      : buildResearchOutline({ ...intent, deliverableType: "ppt.training" }, bundle);
  // Hard gate is enforced in buildDraft via trainingDesenseGateOrThrow.
  // Here we only annotate residual warnings for the slide deck.
  const matterGate = assertTrainingDesensitizeGate({
    matterText: haystack(intent),
    instruction: haystack(intent),
  });
  const desenseNote = matterGate.ok
    ? matterGate.scan.warningCount > 0
      ? `自动扫描通过（仍有 ${matterGate.scan.warningCount} 项警告，请律师终审）。`
      : "未检出阻断级敏感信息（自动扫描，不能替代人工）。"
    : "脱敏门禁未通过（不应到达此分支）。";

  if (outline.status === "approved") {
    return [
      {
        heading: "已确认课件大纲",
        body: `${formatOutlineMarkdown(outline)}\n\n（律师已确认；幻灯片按大纲展开）`,
      },
      {
        heading: "脱敏与引用声明",
        body: `${desenseNote}\n\n详细法条进备注或附录 memo；幻灯片保持短句可讲。`,
      },
      ...expandApprovedOutlineToSections(outline, bundle),
    ];
  }

  const commonIntro: ArtifactSection[] = [
    {
      heading: "课件大纲（请确认）",
      body: `${formatOutlineMarkdown(outline)}\n\n${placeholder("确认大纲后回复「大纲已确认」")}`,
    },
    {
      heading: "脱敏与引用声明",
      body: `${desenseNote}\n\n详细法条进备注或附录 memo；幻灯片保持短句可讲。`,
    },
  ];

  if (variant === "crossborderMatrix") {
    return [
      ...commonIntro,
      {
        heading: "议程",
        body: "1. 范围\n2. 管辖矩阵\n3. 冲突点\n4. 执法趋势\n5. 客户影响\n6. 下一步",
      },
      {
        heading: "范围与假设",
        body: intent.instruction?.trim().slice(0, 600) || placeholder("培训范围与假设"),
      },
      {
        heading: "管辖矩阵",
        body: `| 议题 | 中国内地 | 境外 | 冲突/注意 |\n| --- | --- | --- | --- |\n| ${placeholder("议题")} | ${placeholder("国内")} | ${placeholder("境外")} | ${placeholder("冲突")} |`,
      },
      { heading: "规则要点", body: claimBullets(bundle) },
      {
        heading: "红旗信号",
        body:
          bundle.riskFlags.length > 0
            ? bundle.riskFlags.map((r) => `- ${r}`).join("\n")
            : `- ${placeholder("红旗一")}\n- ${placeholder("红旗二")}`,
      },
      {
        heading: "行动清单",
        body: `1. ${placeholder("动作一")}\n2. ${placeholder("动作二")}\n3. ${placeholder("动作三")}`,
      },
      {
        heading: "来源",
        body:
          bundle.sources.length > 0
            ? bundle.sources.map((s) => `- ${s.title}${s.url ? ` — ${s.url}` : ""}`).join("\n")
            : placeholder("来源列表"),
        citations: bundle.sources.map((s) => s.id),
      },
    ];
  }

  if (variant === "internalKnowledge") {
    return [
      ...commonIntro,
      { heading: "一句话结论", body: claimBullets(bundle, 1) || placeholder("一句话结论") },
      { heading: "制度变化", body: claimBullets(bundle) },
      {
        heading: "对我们案件的含义",
        body: placeholder("结合所内案件类型说明影响（勿含未脱敏事实）"),
      },
      { heading: "操作清单", body: `1. ${placeholder("操作一")}\n2. ${placeholder("操作二")}` },
      {
        heading: "参考书目",
        body:
          bundle.sources.length > 0
            ? bundle.sources.map((s) => `- ${s.title}`).join("\n")
            : placeholder("参考书目"),
      },
    ];
  }

  if (variant === "caseClinic") {
    const safeFacts = redactTrainingText(
      intent.instruction?.trim().slice(0, 800) || placeholder("脱敏事实时间线"),
    );
    return [
      ...commonIntro,
      { heading: "事实时间线（脱敏）", body: safeFacts },
      { heading: "争点", body: `- ${placeholder("争点一")}\n- ${placeholder("争点二")}` },
      { heading: "规范", body: claimBullets(bundle) },
      { heading: "论证路径", body: "Issue → Rule → Application → Conclusion（口播，勿贴全文）" },
      { heading: "教训清单", body: `1. ${placeholder("教训一")}\n2. ${placeholder("教训二")}` },
      {
        heading: "脱敏声明",
        body: "本课件材料已经或应当完成当事人/金额/未公开事实脱敏；禁止外传未公开案情。",
      },
    ];
  }

  // trainingCle default
  return [
    ...commonIntro,
    {
      heading: "议程",
      body: "1. 为什么重要\n2. 规则要点\n3. 案例\n4. 红旗清单\n5. 行动清单\n6. Q&A",
    },
    { heading: "为什么重要", body: placeholder("业务场景与违规代价/机会（一页短句）") },
    { heading: "规则要点", body: claimBullets(bundle) },
    { heading: "案例（脱敏）", body: redactTrainingText(placeholder("简短案例或公开执法动态")) },
    {
      heading: "红旗清单",
      body:
        bundle.riskFlags.length > 0
          ? bundle.riskFlags.map((r) => `- ${r}`).join("\n")
          : `- ${placeholder("红旗一")}\n- ${placeholder("红旗二")}`,
    },
    {
      heading: "行动清单",
      body: `1. ${placeholder("会后动作一")}\n2. ${placeholder("会后动作二")}`,
    },
    { heading: "Q&A", body: "预留提问；复杂法条回答可指向附录 memo。" },
    {
      heading: "来源",
      body:
        bundle.sources.length > 0
          ? bundle.sources.map((s) => `- ${s.title}${s.url ? ` — ${s.url}` : ""}`).join("\n")
          : placeholder("来源"),
      citations: bundle.sources.map((s) => s.id),
    },
  ];
}
