import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";

/** Map technical acceptance keys to lawyer-facing copy. */
export function humanizeAcceptanceLabel(key: string, fallback: string): string {
  const k = key.trim().toLowerCase();
  const map: Record<string, string> = {
    "section.rental": "还缺：租赁相关章节",
    "section.liability": "还缺：违约责任章节",
    "section.dispute": "还缺：争议解决章节",
    "section.governing_law": "还缺：适用法律章节",
    "section.definitions": "还缺：定义与释义章节",
    "section.parties": "还缺：合同主体章节",
    "section.payment": "还缺：价款与支付章节",
    "section.termination": "还缺：终止与解除章节",
    "section.confidentiality": "还缺：保密条款章节",
    "section.force_majeure": "还缺：不可抗力章节",
    "placeholder.todo": "文中仍有【待补充】类占位符",
    "placeholder.bracket": "文中仍有方括号占位符",
    "deliverable.sections": "必备章节未齐",
    "deliverable.placeholders": "占位符未清理完毕",
    "placeholders.resolved": "文中仍有【待补充】占位符",
    "criteria.coverage": "验收标准结构性覆盖",
    "clarifications.closed": "仍有未关闭的追问",
    "draft.body.placeholder_density_heuristic": "正文待填密度偏高（建议项）",
  };
  if (map[k]) {
    return map[k];
  }
  if (k.startsWith("section.")) {
    const tail = k.slice("section.".length).replace(/[._-]+/g, " ");
    return `还缺：${tail || fallback}章节`;
  }
  if (k.includes("placeholder")) {
    return "文中仍有待补充占位符";
  }
  return fallback.trim() || "验收项未通过";
}

export function buildAcceptanceChatPrompt(report: AcceptanceReport): string {
  const failed = report.checks.filter((c) => !c.passed && c.severity === "blocker");
  const lines = failed.slice(0, 5).map((c) => humanizeAcceptanceLabel(c.key, c.label));
  const head =
    lines.length > 0
      ? `请根据文书台验收清单补齐以下内容：\n${lines.map((l) => `- ${l}`).join("\n")}`
      : "请根据文书台验收清单补齐草稿中的缺失项与占位符。";
  return `${head}\n\n（关联草稿已在对话上下文中，请直接修改正文。）`;
}
