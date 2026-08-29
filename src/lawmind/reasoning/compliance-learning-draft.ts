/**
 * Section builders for report.compliance and report.learning deliverables.
 */

import { expandApprovedOutlineToSections } from "../research/outline-expand.js";
import {
  buildResearchOutline,
  formatOutlineMarkdown,
  type ResearchOutline,
} from "../research/research-outline.js";
import type { ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

function placeholder(label: string): string {
  return `【${label}】`;
}

function formatSourceRef(sourceIds: string[], sources: ResearchBundle["sources"]): string {
  if (sourceIds.length === 0) {
    return "";
  }
  const labels = sourceIds.map((id) => {
    const row = sources.find((s) => s.id === id);
    return row ? `[${id}] ${row.title}` : `[${id}]`;
  });
  return `\n（依据：${labels.join("；")}）`;
}

function claimsToProse(
  claims: ResearchBundle["claims"],
  sources: ResearchBundle["sources"],
): string {
  if (claims.length === 0) {
    return placeholder("请补充该章节检索结论或律师意见；不确定处标 [VERIFY]");
  }
  return claims
    .map((claim, index) => {
      const cite = formatSourceRef(claim.sourceIds, sources);
      return `${index + 1}. ${claim.text}${cite}`;
    })
    .join("\n\n");
}

function inferJurisdictionLabel(source: ResearchBundle["sources"][number]): string {
  const host = (() => {
    try {
      return source.url ? new URL(source.url).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  })();
  if (/\.gov\.cn|npc\.gov|court\.gov|samr\.gov|cac\.gov/i.test(host)) {
    return "中国内地";
  }
  if (/\.europa\.eu|\.eu$/i.test(host) || /GDPR|EU/i.test(source.title)) {
    return "欧盟";
  }
  if (/\.gov$|\.gov\.uk|whitehouse|sec\.gov|justice\.gov/i.test(host)) {
    return "美国/英国（请核验）";
  }
  if (/hk|hongkong|\.gov\.hk/i.test(host)) {
    return "中国香港";
  }
  return host || placeholder("管辖区");
}

function inferAuthorityLevel(source: ResearchBundle["sources"][number]): string {
  switch (source.kind) {
    case "statute":
      return "法律/制定法";
    case "regulation":
      return "行政法规/规章";
    case "case":
      return "裁判/执法案例";
    case "web":
      return "网页（须核验效力）";
    default:
      return source.kind || "待定";
  }
}

/** Fill jurisdiction matrix rows from real sources (not empty Mad Libs). */
export function buildJurisdictionMatrixMarkdown(bundle: ResearchBundle): string {
  const header = [
    "按来源主机与类型推断管辖/效力（律师须终核；新闻不得写成现行法）：",
    "",
    `| 管辖区 | 规范/标题 | 层级 | 适用边界 | 效力/时效 | 来源 |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];
  if (bundle.sources.length === 0) {
    return [
      ...header,
      `| ${placeholder("管辖区")} | ${placeholder("规范名称")} | ${placeholder("层级")} | ${placeholder("适用边界")} | ${placeholder("时效")} | ${placeholder("来源ID")} |`,
      "",
      "尚未抓取到来源；请提供 URL 或完成权威检索后再定稿。",
    ].join("\n");
  }
  const rows = bundle.sources.slice(0, 12).map((s) => {
    const jur = inferJurisdictionLabel(s);
    const level = inferAuthorityLevel(s);
    const boundary = s.licenseNote?.slice(0, 40) || placeholder("适用边界");
    const when = s.date || "[VERIFY] 时效";
    return `| ${jur} | ${s.title.replace(/\|/g, "/")} | ${level} | ${boundary} | ${when} | [${s.id}] |`;
  });
  return [...header, ...rows, "", "标注 [VERIFY] 的单元格须在定稿前人工核对。"].join("\n");
}

function partitionByDomain(bundle: ResearchBundle): Record<string, ResearchBundle["claims"]> {
  const buckets: Record<string, ResearchBundle["claims"]> = {
    data: [],
    trade: [],
    market: [],
    labor: [],
    other: [],
  };
  for (const claim of bundle.claims) {
    const t = claim.text;
    if (/数据|隐私|个人信息|GDPR|PIPL|网络安全/i.test(t)) {
      buckets.data.push(claim);
    } else if (/出口|制裁|管制|EAR|实体清单|投资安全/i.test(t)) {
      buckets.trade.push(claim);
    } else if (/广告|反垄断|反不正当|市场监管|消费者/i.test(t)) {
      buckets.market.push(claim);
    } else if (/劳动|用工|雇佣|社保/i.test(t)) {
      buckets.labor.push(claim);
    } else {
      buckets.other.push(claim);
    }
  }
  return buckets;
}

export function inferComplianceTitle(intent: TaskIntent): string {
  const trimmed = intent.summary?.trim();
  if (trimmed && trimmed.length <= 80) {
    return trimmed;
  }
  if (/跨境|涉外/.test(intent.instruction ?? "")) {
    return "涉外合规卷宗备忘录";
  }
  return "合规研究卷宗备忘录";
}

export function inferLearningTitle(intent: TaskIntent): string {
  const trimmed = intent.summary?.trim();
  if (trimmed && trimmed.length <= 80) {
    return trimmed;
  }
  return "法律调研简报";
}

export function buildComplianceReportSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
  approvedOutline?: ResearchOutline | null,
): ArtifactSection[] {
  const outline =
    approvedOutline?.status === "approved"
      ? approvedOutline
      : buildResearchOutline({ ...intent, deliverableType: "report.compliance" }, bundle);

  // STORM write stage: expand the lawyer-approved plan, then append matrix + sources.
  if (outline.status === "approved") {
    const expanded = expandApprovedOutlineToSections(outline, bundle);
    return [
      {
        heading: "已确认研究大纲",
        body: `${formatOutlineMarkdown(outline)}\n\n（律师已确认；正文按大纲展开）`,
      },
      ...expanded,
      {
        heading: "管辖区效力矩阵",
        body: buildJurisdictionMatrixMarkdown(bundle),
        citations: bundle.sources.map((s) => s.id),
      },
      {
        heading: "来源附录",
        body:
          bundle.sources.length > 0
            ? bundle.sources
                .map(
                  (s) =>
                    `- [${s.id}] ${s.title}${s.citation ? ` — ${s.citation}` : ""}${s.url ? ` — ${s.url}` : ""}`,
                )
                .join("\n")
            : placeholder("请附 URL 卷宗或权威检索来源"),
        citations: bundle.sources.map((s) => s.id),
      },
    ];
  }

  const domains = partitionByDomain(bundle);
  const allClaims = bundle.claims;
  return [
    {
      heading: "研究大纲（请确认）",
      body: `${formatOutlineMarkdown(outline)}\n\n${placeholder("请确认大纲后回复「大纲已确认」再定稿")}`,
    },
    {
      heading: "问题陈述",
      body: intent.instruction?.trim() || placeholder("请补充监管问题陈述"),
    },
    {
      heading: "简要结论",
      body:
        allClaims.length > 0
          ? `基于现有来源的初步结论（须律师核验）：\n${claimsToProse(allClaims.slice(0, 3), bundle.sources)}\n\n不确定处请标 [VERIFY]。`
          : placeholder("请在完成检索后填写可/不可/附条件结论，并标 [VERIFY] 事项"),
      citations: allClaims.slice(0, 3).flatMap((c) => c.sourceIds),
    },
    {
      heading: "管辖区效力矩阵",
      body: buildJurisdictionMatrixMarkdown(bundle),
      citations: bundle.sources.map((s) => s.id),
    },
    {
      heading: "风险域发现：数据与隐私",
      body: claimsToProse(domains.data ?? [], bundle.sources),
      citations: (domains.data ?? []).flatMap((c) => c.sourceIds),
    },
    {
      heading: "风险域发现：贸易与管制",
      body: claimsToProse(domains.trade ?? [], bundle.sources),
      citations: (domains.trade ?? []).flatMap((c) => c.sourceIds),
    },
    {
      heading: "风险域发现：市场与广告",
      body: claimsToProse(domains.market ?? [], bundle.sources),
      citations: (domains.market ?? []).flatMap((c) => c.sourceIds),
    },
    {
      heading: "行动建议",
      body:
        bundle.riskFlags.length > 0
          ? `风险提示：\n${bundle.riskFlags.map((r) => `- ${r}`).join("\n")}\n\n建议动作：\n1. ${placeholder("客户侧动作")}\n2. ${placeholder("所内复核")}`
          : `1. ${placeholder("客户侧动作")}\n2. ${placeholder("所内复核")}\n3. ${placeholder("合同/政策修订点")}`,
    },
    {
      heading: "开放问题",
      body:
        bundle.missingItems.length > 0
          ? bundle.missingItems.map((m) => `- ${m}`).join("\n")
          : `- ${placeholder("待客户确认的事实")}\n- ${placeholder("待权威库核实的条文")}`,
    },
    {
      heading: "来源附录",
      body:
        bundle.sources.length > 0
          ? bundle.sources
              .map(
                (s) =>
                  `- [${s.id}] ${s.title}${s.citation ? ` — ${s.citation}` : ""}${s.url ? ` — ${s.url}` : ""}${s.kind ? `（${s.kind}）` : ""}`,
              )
              .join("\n")
          : placeholder("请附 URL 卷宗或权威检索来源（含抓取时间/hash）"),
      citations: bundle.sources.map((s) => s.id),
    },
  ];
}

export function buildLearningBriefSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
  approvedOutline?: ResearchOutline | null,
): ArtifactSection[] {
  const outline =
    approvedOutline?.status === "approved"
      ? approvedOutline
      : buildResearchOutline({ ...intent, deliverableType: "report.learning" }, bundle);
  if (outline.status === "approved") {
    return [
      {
        heading: "已确认研究大纲",
        body: `${formatOutlineMarkdown(outline)}\n\n（律师已确认；正文按大纲展开）`,
      },
      ...expandApprovedOutlineToSections(outline, bundle),
      {
        heading: "来源",
        body:
          bundle.sources.length > 0
            ? bundle.sources
                .map((s) => `- [${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}`)
                .join("\n")
            : placeholder("请补充来源列表"),
        citations: bundle.sources.map((s) => s.id),
      },
    ];
  }
  const half = Math.ceil(bundle.claims.length / 2) || 0;
  const first = bundle.claims.slice(0, half);
  const second = bundle.claims.slice(half);

  return [
    {
      heading: "研究大纲（请确认）",
      body: `${formatOutlineMarkdown(outline)}\n\n${placeholder("确认大纲后回复「大纲已确认」")}`,
    },
    {
      heading: "背景概述",
      body: intent.instruction?.trim() || placeholder("请补充调研背景与读者"),
    },
    {
      heading: "核心概念",
      body: claimsToProse(first, bundle.sources),
      citations: first.flatMap((c) => c.sourceIds),
    },
    {
      heading: "制度要点",
      body: [
        "请按效力层级整理（法律 > 行政法规 > 规章 > 指南 > 新闻评论）：",
        "",
        claimsToProse(second.length > 0 ? second : bundle.claims, bundle.sources),
      ].join("\n"),
      citations: (second.length > 0 ? second : bundle.claims).flatMap((c) => c.sourceIds),
    },
    {
      heading: "比较分析",
      body: [
        `| 维度 | 国内 | 境外/比较 | 差异要点 |`,
        `| --- | --- | --- | --- |`,
        `| ${placeholder("维度")} | ${placeholder("国内要点")} | ${placeholder("境外要点")} | ${placeholder("差异")} |`,
      ].join("\n"),
    },
    {
      heading: "实务启示",
      body:
        bundle.riskFlags.length > 0
          ? bundle.riskFlags.map((r) => `- ${r}`).join("\n")
          : `- ${placeholder("对办案/客户的启示")}\n- ${placeholder("常见误区")}`,
    },
    {
      heading: "结论与建议",
      body: `1. ${placeholder("结论")}\n2. ${placeholder("下一步阅读或行动")}`,
    },
    {
      heading: "来源",
      body:
        bundle.sources.length > 0
          ? bundle.sources
              .map((s) => `- [${s.id}] ${s.title}${s.url ? ` — ${s.url}` : ""}`)
              .join("\n")
          : placeholder("请补充来源列表"),
      citations: bundle.sources.map((s) => s.id),
    },
  ];
}
