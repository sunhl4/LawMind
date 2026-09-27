/**
 * Lawyer-facing wording for acceptance failures.
 *
 * The export path and the review pane share this copy so a blocked render
 * names the missing pieces, instead of a component name or a gate id.
 */

import type { AcceptanceCheck, AcceptanceReport, ReasoningReport } from "./types.js";

const EXACT: Record<string, string> = {
  "placeholders.resolved": "文中仍有未填项（【…】）",
  "placeholder.todo": "文中仍有未填项（【…】）",
  "placeholder.bracket": "文中仍有未填项（【…】）",
  "deliverable.placeholders": "占位符未清理完毕",
  "deliverable.sections": "必备章节未齐",
  "spec.not_found": "未标明这是哪一类文书",
  "criteria.coverage": "必要章节还没齐，验收标准对不上",
  "clarifications.closed": "仍有未关闭的追问",
  "draft.body.placeholder_density_heuristic": "正文待填内容偏多",
  "draft.scaffold_density": "仍是骨架稿，补全后才能交付",
  "contract.review.clause_anchor": "主要风险还没指到具体条款",
  "contract.review.recommended_wording": "修改建议还没写出可替换的句子",
  "calc.formula_source": "金额或届满日还没有计算公式",
  "exhibit.purpose": "证据还没写证明目的",
  "complaint.linear_columns": "起诉状里还有表格，应改成线性栏目",
  "timeline.empty_row": "时间线里有空行",
  "letter.internal_analysis": "对外函件里还有内部分析",
  "research.keep_column": "没检索到时栏目还在，但没标待核实",
  "memo.internal.not_outbound": "内部备忘写成了可外发函",
};

/** Drop only the keyword gloss. Counts such as `（当前 0）` stay; the model needs them. */
function purposeFromLabel(label: string): string {
  const purpose = label.replace(/（关键词：[^）]*）/g, "").trim();
  if (!purpose || /^section\./i.test(purpose)) {
    return "";
  }
  return purpose;
}

/**
 * Turn a check key into a sentence a lawyer can act on.
 * Section keys are `section.<index>.<keyword>`; the index must not appear.
 */
export function humanizeAcceptanceLabel(key: string, fallback: string): string {
  const k = key.trim().toLowerCase();
  const exact = EXACT[k];
  if (exact) {
    return exact;
  }
  if (k.startsWith("section.")) {
    const purpose = purposeFromLabel(fallback);
    if (purpose) {
      return `还缺：${purpose}`;
    }
    const tail = k.replace(/^section\.\d+\./, "").trim();
    return tail ? `还缺：${tail}` : "还缺必要章节";
  }
  if (k.includes("placeholder")) {
    return "文中仍有待补充占位符";
  }
  const cleaned = purposeFromLabel(fallback);
  return cleaned || "这一项还没过";
}

export function buildAcceptanceChatPrompt(report: AcceptanceReport): string {
  const failed = report.checks.filter((c) => !c.passed && c.severity === "blocker");
  const lines = failed.slice(0, 5).map((c) => humanizeAcceptanceLabel(c.key, c.label));
  const head =
    lines.length > 0
      ? `请补齐下面这些缺口后再交稿：\n${lines.map((l) => `- ${l}`).join("\n")}`
      : "请补齐草稿里还没写完的章节和未填项。";
  return `${head}\n\n（当前草稿已在对话里，请直接改正文。）`;
}

/** Keywords stay in the model repair line. They are not part of the lawyer sentence. */
function keywordRepair(label: string): string {
  const match = /（关键词：([^）]*)）/.exec(label);
  const words = match?.[1]
    ?.split(/[/、]/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words || words.length === 0) {
    return "";
  }
  return `标题或节首写上：${words.join("、")}。`;
}

function failedLines(
  checks: readonly AcceptanceCheck[],
  severity: "blocker" | "warning",
  limit: number,
): string[] {
  const failed = checks.filter((c) => !c.passed && c.severity === severity);
  const prefix = severity === "warning" ? "提醒：" : "";
  const shown = failed.slice(0, limit).map((c) => {
    const label = `${prefix}${humanizeAcceptanceLabel(c.key, c.label)}`;
    const extra = [c.hint?.trim(), keywordRepair(c.label)].filter(Boolean).join("");
    return extra ? `- ${label}。${extra}` : `- ${label}`;
  });
  if (failed.length > limit) {
    shown.push(`- 另有 ${failed.length - limit} 项${severity === "warning" ? "提醒" : "未过"}`);
  }
  return shown;
}

/**
 * Refusal returned to the model and the export caller.
 * Names the gaps so the same turn can repair them, the way a compiler lists errors.
 */
export function formatRenderGateRefusal(input: {
  acceptance?: Pick<AcceptanceReport, "checks"> | null;
  reasoning?: Pick<ReasoningReport, "required" | "ready" | "checks"> | null;
}): string {
  const checks = input.acceptance?.checks ?? [];
  const lines = [
    "还不能导出。",
    ...failedLines(checks, "blocker", 6),
    ...failedLines(checks, "warning", 4),
  ];
  if (input.reasoning?.required && !input.reasoning.ready) {
    const reasoningFails = (input.reasoning.checks ?? []).filter(
      (c) => !c.passed && c.severity === "blocker",
    );
    if (reasoningFails.length === 0) {
      lines.push("- 法律分析还没写清争点和依据");
    } else {
      for (const check of reasoningFails.slice(0, 4)) {
        lines.push(`- ${purposeFromLabel(check.label) || check.label}`);
      }
    }
  }
  if (lines.length === 1) {
    lines.push("- 出稿检查未通过");
  }
  lines.push("请按上面的缺口补全正文后再导出。通过核对不等于法律正确。");
  return lines.join("\n");
}
