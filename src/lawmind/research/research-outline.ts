/**
 * Research outline — pre-writing plan for compliance / learning / training decks.
 * Inspired by STORM (outline before write) + Co-STORM human confirmation.
 */

import type { ClarificationQuestion, ResearchBundle, TaskIntent } from "../types.js";
import { outlineLooksApproved } from "./outline-hitl.js";

export type ResearchOutlineSection = {
  id: string;
  heading: string;
  bullets: string[];
  purpose: string;
};

export type ResearchOutline = {
  title: string;
  deliverableType?: string;
  status: "pending" | "approved";
  sections: ResearchOutlineSection[];
  notes: string[];
};

export { outlineLooksApproved } from "./outline-hitl.js";

function instructionHaystack(intent: TaskIntent): string {
  return `${intent.instruction ?? ""} ${intent.summary ?? ""}`.trim();
}

function defaultComplianceSections(intent: TaskIntent): ResearchOutlineSection[] {
  const text = instructionHaystack(intent);
  const jurisdictions = /美国|欧盟|EU|英国|香港|新加坡|日本|跨境|涉外/.test(text)
    ? ["中国内地", "相关境外管辖区（【待补充】）"]
    : ["适用管辖区（【待补充】）"];
  return [
    {
      id: "q_presented",
      heading: "问题陈述与简要结论",
      purpose: "Brief Answer 前置",
      bullets: ["监管问题一句话", "结论（可/不可/附条件）", "关键不确定点标 [VERIFY]"],
    },
    {
      id: "jurisdiction",
      heading: "管辖区与效力层级矩阵",
      purpose: "区分立法/规章/指南/执法",
      bullets: jurisdictions.map((j) => `${j}：规范层级与适用边界`),
    },
    {
      id: "findings",
      heading: "按风险域的发现",
      purpose: "按风险域而非按网站堆砌",
      bullets: ["数据与隐私", "出口管制/制裁（如适用）", "市场监管/广告", "劳动与用工（如适用）"],
    },
    {
      id: "actions",
      heading: "行动建议与开放问题",
      purpose: "可执行下一步",
      bullets: ["客户侧动作", "所内复核项", "开放问题清单"],
    },
    {
      id: "sources",
      heading: "来源附录",
      purpose: "provenance",
      bullets: ["URL / 抓取时间 / hash", "效力标注"],
    },
  ];
}

function defaultLearningSections(intent: TaskIntent): ResearchOutlineSection[] {
  const topic = intent.summary?.trim() || "主题";
  return [
    {
      id: "background",
      heading: "背景与核心概念",
      purpose: "速览",
      bullets: [`${topic} 为何重要`, "关键术语"],
    },
    {
      id: "regime",
      heading: "制度要点",
      purpose: "效力分级",
      bullets: ["立法/规章要点", "执法或实务趋势", "新闻/博客不得写成现行法"],
    },
    {
      id: "compare",
      heading: "比较与实务启示",
      purpose: "国内外对照",
      bullets: ["比较表", "对办案/客户的启示", "进一步阅读"],
    },
  ];
}

function defaultTrainingSections(intent: TaskIntent): ResearchOutlineSection[] {
  const text = instructionHaystack(intent);
  const duration = text.match(/(\d+)\s*(分钟|min)/i)?.[0] ?? "约 30 分钟";
  return [
    { id: "cover", heading: "封面与议程", purpose: "开场", bullets: ["主题", "受众", duration] },
    {
      id: "why",
      heading: "为什么重要",
      purpose: "动机",
      bullets: ["业务场景", "违规代价或机会"],
    },
    {
      id: "rules",
      heading: "规则要点（3–5 页）",
      purpose: "可讲短句",
      bullets: ["要点一", "要点二", "要点三"],
    },
    {
      id: "case",
      heading: "案例 / 脱敏材料",
      purpose: "结合实务",
      bullets: ["脱敏声明", "事实时间线", "争点与规范"],
    },
    {
      id: "checklist",
      heading: "红旗与行动清单",
      purpose: "带走可用",
      bullets: ["红旗信号", "行动清单", "Q&A / 来源"],
    },
  ];
}

export function buildResearchOutline(
  intent: TaskIntent,
  bundle?: ResearchBundle | null,
): ResearchOutline {
  const dt = intent.deliverableType;
  let sections: ResearchOutlineSection[];
  let title: string;
  if (dt === "report.compliance") {
    title = "涉外合规卷宗研究大纲";
    sections = defaultComplianceSections(intent);
  } else if (dt === "report.learning" || dt === "document.report") {
    title = "学习型调研大纲";
    sections = defaultLearningSections(intent);
  } else if (dt === "ppt.training" || intent.kind === "draft.ppt") {
    title = "培训课件大纲";
    sections = defaultTrainingSections(intent);
  } else {
    title = "研究大纲";
    sections = defaultLearningSections(intent);
  }

  const notes: string[] = [];
  if (bundle?.sources.length) {
    notes.push(`已挂接 ${bundle.sources.length} 条来源，可用于填充各章。`);
  }
  if (bundle?.missingItems.length) {
    notes.push(...bundle.missingItems.slice(0, 5).map((m) => `待补：${m}`));
  }

  const status = outlineLooksApproved(instructionHaystack(intent)) ? "approved" : "pending";
  return { title, deliverableType: dt, status, sections, notes };
}

export function formatOutlineMarkdown(outline: ResearchOutline): string {
  const lines: string[] = [`# ${outline.title}`, "", `状态：${outline.status}`, ""];
  for (const s of outline.sections) {
    lines.push(`## ${s.heading}`, `（${s.purpose}）`);
    for (const b of s.bullets) {
      lines.push(`- ${b}`);
    }
    lines.push("");
  }
  if (outline.notes.length > 0) {
    lines.push("## 备注");
    for (const n of outline.notes) {
      lines.push(`- ${n}`);
    }
  }
  return lines.join("\n").trim();
}

/** Clarification gate when outline not yet approved. */
export function outlineClarificationQuestion(
  outline: ResearchOutline,
): ClarificationQuestion | null {
  if (outline.status === "approved") {
    return null;
  }
  return {
    key: "research_outline_confirm",
    question: `请确认或调整研究大纲\n\n${formatOutlineMarkdown(outline)}`,
    reason: "先确认大纲再写正文；可编辑章节后确认，或不同意以按检索重建。",
    inputType: "textarea",
    required: true,
  };
}
