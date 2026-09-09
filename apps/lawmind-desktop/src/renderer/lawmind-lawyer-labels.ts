import { getDeliverableSpec } from "../../../../src/lawmind/deliverables/registry.ts";

/** Workflow / office types that are not always in the deliverable registry. */
const WORKFLOW_DELIVERABLE_LABELS: Record<string, string> = {
  "ppt.training": "培训课件 / PPT",
  "document.speech": "讲稿 / 讲义",
  "document.report": "研究报告",
  "document.general": "通用文书",
  "contract.review": "合同审查意见",
  "contract.rental": "房屋租赁合同",
  "contract.general": "通用商务合同",
  "labor.calc": "劳动补偿计算",
  "period.calc": "程序期限计算",
  "ops.invoice": "发票整理",
  "ip.dispute": "知产争议",
  "deal.ma": "并购尽调",
  "compliance.data": "数据合规备忘",
  "compliance.ads": "广告产品合规备忘",
  "matter.status": "办案周报",
  "family.matter": "家事继承",
  "capital.markets": "资本市场核对",
  "corp.governance": "公司治理",
  "letter.demand": "催告函",
  "letter.counsel": "律师函",
  "letter.reply": "回函稿",
  "litigation.outline": "诉讼策略提纲",
  "litigation.complaint": "起诉状",
  "litigation.answer": "答辩状",
  "litigation.brief": "代理词",
  "memo.opinion": "法律意见书",
  "memo.internal": "内部备忘",
  "memo.research": "检索研究备忘",
  "matter.timeline": "案件时间线",
  "matter.exhibit_list": "证据目录",
  "meeting.minutes": "会议纪要",
  "contract.nda": "保密协议",
  "report.esg": "ESG / 可持续发展报告",
  "report.general": "研究报告 / 专项报告",
  "report.compliance": "涉外合规卷宗备忘录",
  "report.learning": "学习型调研简报",
};

const RISK_LABELS: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "常规",
};

const AUDIENCE_LABELS: Record<string, string> = {
  solo: "个人/内部",
  firm: "所内协作",
  client: "客户沟通",
  court: "诉讼/仲裁",
  counterparty: "对方律师",
};

/** Lawyer-facing deliverable label; never surface raw type codes like `ppt.training`. */
export function lawyerDeliverableTypeLabel(type: string | undefined | null): string | null {
  const key = type?.trim();
  if (!key) {
    return null;
  }
  const mapped = WORKFLOW_DELIVERABLE_LABELS[key];
  if (mapped) {
    return mapped;
  }
  const fromSpec = getDeliverableSpec(key)?.displayName?.trim();
  if (fromSpec) {
    return fromSpec;
  }
  // Unknown extension types: soften dotted codes into a short readable token.
  if (key.includes(".")) {
    const last = key.split(".").pop() ?? key;
    return last.replace(/[_-]+/g, " ");
  }
  return key;
}

export function lawyerRiskLevelLabel(risk: string | undefined | null): string | null {
  const key = risk?.trim().toLowerCase();
  if (!key) {
    return null;
  }
  return RISK_LABELS[key] ?? risk!.trim();
}

export function lawyerAudienceLabel(audience: string | undefined | null): string | null {
  const key = audience?.trim().toLowerCase();
  if (!key) {
    return null;
  }
  return AUDIENCE_LABELS[key] ?? audience!.trim();
}
