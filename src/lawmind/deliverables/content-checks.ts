/**
 * Objective content checks. These are warnings: they name a measurable gap
 * (formula, purpose, empty row, markdown table) and do not block export.
 */

import type { ArtifactDraft } from "../types.js";
import type { AcceptanceCheck, DeliverableSpec } from "./types.js";

function plain(draft: ArtifactDraft): string {
  return draft.sections.map((section) => `${section.heading}\n${section.body}`).join("\n");
}

function warn(key: string, label: string, hint: string): AcceptanceCheck {
  return { key, label, passed: false, severity: "warning", hint };
}

const AMOUNT_RE = /\d[\d,]*(?:\.\d+)?\s*(?:元|万元)/;
const FORMULA_RE = /公式|[=＝×÷]|calculate|计算式|未代算|不要口算/i;
const DATE_RE = /\d{4}[-/.年]\d{1,2}/;
const MARKDOWN_TABLE_RE = /\|[^\n]+\|\s*\n\s*\|[\s|:-]{3,}\|/;
const EMPTY_TABLE_ROW_RE = /^\|\s*(?:\|\s*)+$/m;
const INTERNAL_ANALYSIS_RE = /我方的弱点|我方弱点|内部分析|不宜写进函|败诉风险在于/;
const NO_HIT_RE = /无命中|未检索到|没有类案|未找到类案/;
const VERIFY_RE = /待核实|\[VERIFY\]|〔待核实〕/;
const PROOF_PURPOSE_RE = /证明目的|证明对象|证明内容/;

function calcCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "labor.calc" && spec.type !== "period.calc" && spec.type !== "analysis.table") {
    return undefined;
  }
  const text = plain(draft);
  const hasAmount = AMOUNT_RE.test(text);
  const hasDate = DATE_RE.test(text);
  const hasFigure = spec.type === "period.calc" ? hasDate || hasAmount : hasAmount;
  if (!hasFigure || FORMULA_RE.test(text)) {
    return undefined;
  }
  if (spec.type === "analysis.table" && /来源|出处/.test(text)) {
    return undefined;
  }
  return warn(
    "calc.formula_source",
    "金额或届满日须带来源公式",
    "写出计算公式，或标明缺口。不要口算一个没有式子的数字。",
  );
}

function exhibitCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "matter.exhibit_list") {
    return undefined;
  }
  if (PROOF_PURPOSE_RE.test(plain(draft))) {
    return undefined;
  }
  return warn(
    "exhibit.purpose",
    "证据目录须写证明目的",
    "每条证据写名称和证明目的。只有名称的清单不能用。",
  );
}

function complaintCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "litigation.complaint" || !MARKDOWN_TABLE_RE.test(plain(draft))) {
    return undefined;
  }
  return warn(
    "complaint.linear_columns",
    "起诉状用线性栏目，不用表格",
    "要素式事实写成「要件：…」段落。Markdown 表在 Word 里会排坏。",
  );
}

function timelineCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "matter.timeline" || !EMPTY_TABLE_ROW_RE.test(plain(draft))) {
    return undefined;
  }
  return warn("timeline.empty_row", "时间线不得用空行充数", "删掉没有日期和事实的空行。");
}

function letterCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "letter.demand" || !INTERNAL_ANALYSIS_RE.test(plain(draft))) {
    return undefined;
  }
  return warn(
    "letter.internal_analysis",
    "对外函件不写内部分析",
    "删掉「我方弱点」一类内部判断。函件只保留事实、主张、期限和后果。",
  );
}

function researchCheck(draft: ArtifactDraft, spec: DeliverableSpec): AcceptanceCheck | undefined {
  if (spec.type !== "memo.research") {
    return undefined;
  }
  const missedWithoutMark = draft.sections.some((section) => {
    const text = `${section.heading}\n${section.body}`;
    return NO_HIT_RE.test(text) && !VERIFY_RE.test(text);
  });
  if (!missedWithoutMark) {
    return undefined;
  }
  return warn(
    "research.keep_column",
    "无命中也要保留栏目并标待核实",
    "正向或反向类案没有命中时，栏目留着，写「待核实」，不要删节。",
  );
}

function internalMemoCheck(
  draft: ArtifactDraft,
  spec: DeliverableSpec,
): AcceptanceCheck | undefined {
  if (spec.type !== "memo.internal") {
    return undefined;
  }
  const signOff = draft.sections.some((section) => {
    const block = `${section.heading}\n${section.body}`;
    return /落款|签署|此致/.test(section.heading) && /此致/.test(block) && /律师事务所/.test(block);
  });
  if (!signOff) {
    return undefined;
  }
  return warn(
    "memo.internal.not_outbound",
    "内部备忘不要写成可外发函",
    "去掉「此致」和事务所落款。对外签发用律师函规格。",
  );
}

export function buildObjectiveContentChecks(
  draft: ArtifactDraft,
  spec: DeliverableSpec,
): AcceptanceCheck[] {
  return [
    calcCheck(draft, spec),
    exhibitCheck(draft, spec),
    complaintCheck(draft, spec),
    timelineCheck(draft, spec),
    letterCheck(draft, spec),
    researchCheck(draft, spec),
    internalMemoCheck(draft, spec),
  ].filter((check): check is AcceptanceCheck => check !== undefined);
}
