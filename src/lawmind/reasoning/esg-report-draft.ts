import type { ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

function buildPlaceholder(label: string): string {
  return `【${label}】`;
}

function instructionText(intent: TaskIntent): string {
  return `${intent.instruction ?? ""} ${intent.summary ?? ""}`.trim();
}

/** Derive a client-facing report title from the user instruction. */
export function inferEsgReportTitle(intent: TaskIntent): string {
  const text = instructionText(intent);
  const lower = text.toLowerCase();
  const hasEu = /欧盟|\beu\b|european union/i.test(text);
  const hasNev = /新能源|电动汽车|电动车|nev|electric vehicle|ev\b/i.test(lower);
  const hasEsg = /esg|可持续|可持续发展|环境.?社会.?治理/i.test(text);

  if (hasEu && hasNev && hasEsg) {
    return "欧盟新能源汽车行业 ESG 合规与披露报告";
  }
  if (hasEu && hasEsg) {
    return "欧盟 ESG 合规与披露报告";
  }
  if (hasNev && hasEsg) {
    return "新能源汽车 ESG 可持续发展报告";
  }
  if (hasEsg) {
    return "ESG 可持续发展报告";
  }
  const trimmed = intent.summary?.trim();
  if (trimmed && trimmed.length <= 80) {
    return trimmed;
  }
  return "ESG 可持续发展报告";
}

function reportScopeLabel(intent: TaskIntent): string {
  const text = instructionText(intent);
  if (/欧盟|\beu\b/i.test(text) && /新能源|nev|电动汽车/i.test(text)) {
    return "在欧盟市场开展业务或面向欧盟披露义务的新能源汽车及相关产业链企业";
  }
  if (/欧盟|\beu\b/i.test(text)) {
    return "受欧盟可持续发展与产品合规规则约束的相关主体";
  }
  return "适用 ESRS / 当地监管要求的报告主体";
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
    return buildPlaceholder("请补充该章节检索结论或律师意见");
  }
  return claims
    .map((claim, index) => {
      const cite = formatSourceRef(claim.sourceIds, sources);
      return `${index + 1}. ${claim.text}${cite}`;
    })
    .join("\n\n");
}

function partitionClaims(bundle: ResearchBundle): {
  regulatory: ResearchBundle["claims"];
  environmental: ResearchBundle["claims"];
  social: ResearchBundle["claims"];
  governance: ResearchBundle["claims"];
  remainder: ResearchBundle["claims"];
} {
  const regulatory: ResearchBundle["claims"] = [];
  const environmental: ResearchBundle["claims"] = [];
  const social: ResearchBundle["claims"] = [];
  const governance: ResearchBundle["claims"] = [];
  const remainder: ResearchBundle["claims"] = [];

  for (const claim of bundle.claims) {
    const t = claim.text;
    if (/csrd|esrs|taxonomy|分类法|电池法|battery|regulation|指令|法规|合规框架|披露/i.test(t)) {
      regulatory.push(claim);
    } else if (/碳|排放|气候|环境|回收|足迹|能源|e\b|environment/i.test(t)) {
      environmental.push(claim);
    } else if (/供应链|劳工|员工|社区|人权|尽职调查|social|社会/i.test(t)) {
      social.push(claim);
    } else if (/治理|内控|董事会|合规|governance|治理/i.test(t)) {
      governance.push(claim);
    } else {
      remainder.push(claim);
    }
  }

  return { regulatory, environmental, social, governance, remainder };
}

function esgDimensionBody(
  dimension: "环境（E）" | "社会（S）" | "治理（G）",
  topics: string[],
  claims: ResearchBundle["claims"],
  sources: ResearchBundle["sources"],
): string {
  const intro = `本章节聚焦 ${dimension} 维度，结合欧盟新能源汽车行业常见披露议题整理如下：`;
  const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const body =
    claims.length > 0
      ? claimsToProse(claims, sources)
      : `${intro}\n${topicList}\n\n${buildPlaceholder(`请补充${dimension}维度定量指标、统计口径与数据来源`)}`;
  return claims.length > 0 ? `${intro}\n\n${body}` : body;
}

function appendRiskTail(sections: ArtifactSection[], bundle: ResearchBundle): ArtifactSection[] {
  const out = [...sections];
  if (bundle.riskFlags.length > 0) {
    out.push({
      heading: "风险提示",
      body: bundle.riskFlags.map((r) => `- ${r}`).join("\n"),
    });
  }
  if (bundle.missingItems.length > 0) {
    out.push({
      heading: "待补充事项",
      body: bundle.missingItems.map((m) => `- ${m}`).join("\n"),
    });
  }
  return out;
}

export function buildEsgReportSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
): ArtifactSection[] {
  const scope = reportScopeLabel(intent);
  const parts = partitionClaims(bundle);
  const regulatoryClaims =
    parts.regulatory.length > 0
      ? parts.regulatory
      : [...parts.remainder, ...bundle.claims].slice(0, 6);

  const sections: ArtifactSection[] = [
    {
      heading: "执行摘要",
      body: [
        `本报告旨在回应「${intent.instruction.trim() || intent.summary}」之需求，面向${scope}，`,
        "梳理欧盟可持续发展披露与新能源汽车产品合规交叉领域的主要义务、实施要点与行动建议。",
        "正文基于已完成的法规与案例检索结论撰写；定量指标、审计鉴证及对外发布口径须由经办律师最终确认。",
      ].join(""),
    },
    {
      heading: "一、报告背景与范围",
      body: [
        `1.1 编制目的：${intent.instruction.trim() || intent.summary}`,
        `1.2 适用主体与范围：${scope}`,
        "1.3 参考框架：欧盟《企业可持续发展报告指令》（CSRD）及欧洲可持续发展报告准则（ESRS）、",
        "欧盟分类法（EU Taxonomy）、《新电池法》（Battery Regulation）及相关行业指南。",
        `1.4 检索概况：共 ${bundle.sources.length} 条来源、${bundle.claims.length} 条结论。`,
      ].join("\n"),
    },
    {
      heading: "二、监管与合规框架",
      body: claimsToProse(regulatoryClaims, bundle.sources),
    },
    {
      heading: "三、环境（E）维度",
      body: esgDimensionBody(
        "环境（E）",
        [
          "产品全生命周期碳足迹与范围 1–3 排放",
          "动力电池碳足迹声明、再生材料比例与回收义务",
          "生产用能结构、可再生电力与能效改进",
          "环境风险、污染预防与循环经济安排",
        ],
        parts.environmental.length > 0 ? parts.environmental : parts.remainder.slice(0, 2),
        bundle.sources,
      ),
    },
    {
      heading: "四、社会（S）维度",
      body: esgDimensionBody(
        "社会（S）",
        [
          "供应链人权与负责任采购（含关键矿物）",
          "劳工标准、职业健康与安全",
          "产品安全、客户隐私与社区影响",
          "供应商尽职调查与申诉机制",
        ],
        parts.social,
        bundle.sources,
      ),
    },
    {
      heading: "五、治理（G）维度",
      body: esgDimensionBody(
        "治理（G）",
        [
          "董事会 ESG 监督与风险管理架构",
          "合规管理、反贿赂与信息披露内控",
          "双重重要性评估流程与利益相关方参与",
          "ESG 数据治理、鉴证与外部保证安排",
        ],
        parts.governance,
        bundle.sources,
      ),
    },
    {
      heading: "六、关键指标与披露建议",
      body: [
        "建议在正式对外版本至少披露以下指标类别（含统计口径与基准年）：",
        "1. 温室气体排放（范围 1/2/3）及强度指标；",
        "2. 动力电池碳足迹、再生材料含量与回收率；",
        "3. 供应链尽职调查覆盖率与重大风险事件；",
        "4. ESRS 要求下的治理架构与重要性评估结论。",
        parts.remainder.length > 0
          ? `\n补充检索要点：\n${claimsToProse(parts.remainder, bundle.sources)}`
          : `\n${buildPlaceholder("请补充企业实际 KPI 数据与 ESRS 对标表")}`,
      ].join("\n"),
    },
    {
      heading: "七、结论与下一步行动",
      body: [
        "综合上述检索结论，新能源汽车企业在欧盟 ESG 语境下应优先完成：",
        "（1）识别 CSRD 适用性与披露时间表；",
        "（2）建立电池法碳足迹与供应链尽职调查数据链；",
        "（3）按 ESRS 开展双重重要性评估并搭建指标收集机制；",
        "（4）在律师与可持续顾问复核后形成对外披露版本。",
      ].join("\n"),
    },
  ];

  if (bundle.sources.length > 0) {
    sections.push({
      heading: "附录：检索来源",
      body: bundle.sources
        .map((s) => `- [${s.id}] ${s.title}${s.citation ? ` — ${s.citation}` : ""}（${s.kind}）`)
        .join("\n"),
    });
  }

  return appendRiskTail(sections, bundle);
}

export function buildGeneralReportSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
): ArtifactSection[] {
  const sections: ArtifactSection[] = [
    {
      heading: "执行摘要",
      body: `本报告回应「${intent.instruction.trim() || intent.summary}」。${bundle.claims.length > 0 ? "以下摘要基于检索结论整理。" : buildPlaceholder("请补充执行摘要")}`,
    },
    {
      heading: "一、背景与问题界定",
      body: intent.instruction.trim() || intent.summary,
    },
    {
      heading: "二、分析与发现",
      body: claimsToProse(bundle.claims, bundle.sources),
    },
    {
      heading: "三、结论与建议",
      body: buildPlaceholder("请律师根据分析章节归纳结论与可执行建议"),
    },
  ];
  return appendRiskTail(sections, bundle);
}
