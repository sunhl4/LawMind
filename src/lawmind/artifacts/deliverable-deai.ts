/**
 * 出件默认去 AI 味（确定性，零模型）。
 *
 * 律师无需点选：render Word 前自动去掉产品自称、AI 底稿栏目，
 * 并对非法律题材把「法律分析」收成「分析」。措辞套话只做高置信替换，
 * 不改法条、案号、数字与书名号内容。
 */

import type { ArtifactDraft, ArtifactSection, DeliverableType } from "../types.js";

export type DeliverableDeaiChange = {
  kind: "strip_product" | "drop_section" | "rename_heading" | "phrase";
  detail: string;
};

export type DeliverableDeaiResult = {
  draft: ArtifactDraft;
  changes: DeliverableDeaiChange[];
};

/** 业务进度 / 一般报告：不要硬套「法律分析」。 */
const BUSINESS_REPORT_TYPES = new Set<string>([
  "report.general",
  "report.esg",
  "report.learning",
  "meeting.minutes",
  "document.general",
]);

const AI_WORKBENCH_HEADING =
  /检索\s*[／/]?\s*研究策略|检索策略|研究策略|支撑材料|时效性与局限|可靠性\s*(分级|评级)?|^执行方式$|^关键词$|^执行时间$/;

const PRODUCT_SELF_REF =
  /LawMind\s*法律助理|LawMind\s*智能助理|LawMind\s*AI|作为\s*(一个)?(AI|人工智能|大语言模型|大模型)/gi;

/** 高置信套话：整段删或掐掉前缀，不动法条/案号。 */
const PHRASE_RULES: Array<{ re: RegExp; replacement: string; label: string }> = [
  { re: /希望这对你(们)?有帮助[。.!！]?/g, replacement: "", label: "希望这对你有帮助" },
  {
    re: /如有其他问题[，,]?\s*请随时[^。.!！\n]*[。.!！]?/g,
    replacement: "",
    label: "如有其他问题请随时…",
  },
  { re: /总之[，,:：]\s*/g, replacement: "", label: "总之，" },
  { re: /值得注意的是[，,]?\s*/g, replacement: "", label: "值得注意的是" },
  { re: /此外[，,]?\s*需要指出的是[，,]?\s*/g, replacement: "", label: "此外需要指出" },
  { re: /在当今[^，,。.!！\n]*[，,]\s*/g, replacement: "", label: "在当今…" },
  { re: /赋能/g, replacement: "", label: "赋能" },
  { re: /抓手/g, replacement: "", label: "抓手" },
  { re: /颗粒度/g, replacement: "", label: "颗粒度" },
  { re: /闭环/g, replacement: "", label: "闭环" },
];

export function isBusinessReportDeliverable(type: DeliverableType | undefined): boolean {
  return Boolean(type && BUSINESS_REPORT_TYPES.has(type));
}

function tidyProse(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

function stripProductSelfRefs(text: string): { text: string; hit: boolean } {
  const before = tidyProse(text);
  let next = text.replace(PRODUCT_SELF_REF, "");
  // 文首栏位被模型写进正文时：自：LawMind… → 自：
  next = next.replace(/自\s*[：:]\s*LawMind[^\n]*/gi, "自：");
  next = next.replace(/自\s*[：:]\s*法律助理[^\n]*/g, "自：");
  next = tidyProse(next);
  return { text: next, hit: next !== before };
}

function applyPhraseRules(text: string): { text: string; labels: string[] } {
  const labels: string[] = [];
  let next = text;
  for (const rule of PHRASE_RULES) {
    if (rule.re.test(next)) {
      labels.push(rule.label);
      next = next.replace(rule.re, rule.replacement);
    }
    rule.re.lastIndex = 0;
  }
  return { text: tidyProse(next), labels };
}

function polishText(text: string, changes: DeliverableDeaiChange[], where: string): string {
  const stripped = stripProductSelfRefs(text);
  let next = stripped.text;
  if (stripped.hit) {
    changes.push({ kind: "strip_product", detail: where });
  }
  const phrases = applyPhraseRules(next);
  next = phrases.text;
  for (const label of phrases.labels) {
    changes.push({ kind: "phrase", detail: `${where}: ${label}` });
  }
  return next;
}

function shouldDropSection(heading: string): boolean {
  const h = heading.trim();
  if (!h) {
    return false;
  }
  // 去掉编号前缀再匹配
  const bare = h
    .replace(/^[0-9零一二三四五六七八九十百]+[、.．\s]+/, "")
    .replace(/^[（(][^）)]+[）)]\s*/, "");
  return AI_WORKBENCH_HEADING.test(h) || AI_WORKBENCH_HEADING.test(bare);
}

function renameHeadingIfNeeded(
  heading: string,
  deliverableType: DeliverableType | undefined,
): { heading: string; renamed: boolean } {
  if (!isBusinessReportDeliverable(deliverableType)) {
    return { heading, renamed: false };
  }
  if (!heading.includes("法律分析")) {
    return { heading, renamed: false };
  }
  return { heading: heading.replace(/法律分析/g, "分析"), renamed: true };
}

/**
 * 对交件草稿做默认去 AI 味。返回新对象，不改入参。
 */
export function polishDeliverableDraft(draft: ArtifactDraft): DeliverableDeaiResult {
  const changes: DeliverableDeaiChange[] = [];

  const summary = polishText(draft.summary, changes, "summary");
  let audience = draft.audience;
  if (audience) {
    const polishedAudience = polishText(audience, changes, "audience");
    audience = polishedAudience || undefined;
  }

  const sections: ArtifactSection[] = [];
  for (const section of draft.sections) {
    if (shouldDropSection(section.heading)) {
      changes.push({ kind: "drop_section", detail: section.heading });
      continue;
    }
    const renamed = renameHeadingIfNeeded(section.heading, draft.deliverableType);
    if (renamed.renamed) {
      changes.push({
        kind: "rename_heading",
        detail: `${section.heading} → ${renamed.heading}`,
      });
    }
    const body = polishText(section.body, changes, renamed.heading || section.heading);
    sections.push({
      ...section,
      heading: renamed.heading,
      body,
    });
  }

  return {
    draft: {
      ...draft,
      summary,
      audience,
      sections,
    },
    changes,
  };
}
