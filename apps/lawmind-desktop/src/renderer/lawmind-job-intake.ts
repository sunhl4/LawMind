/**
 * Build a structured 「交办」prompt from intake form answers.
 * Marked so intake-gate skips re-asking.
 */

import { lawyerDeliverableTypeLabel } from "./lawmind-lawyer-labels";

export type JobIntakeFieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
};

export type JobIntakeFieldValue = {
  key: string;
  label: string;
  value: string;
};

/** Default intake fields when a workflow template omits intakeFields. */
export function defaultIntakeFieldsForDeliverable(
  deliverableType: string | undefined,
): JobIntakeFieldDef[] {
  switch (deliverableType) {
    case "contract.review":
      return [
        { key: "materials", label: "合同/材料说明", placeholder: "已引用文件，或简述合同名称与关键条款位置", required: true, multiline: true },
        { key: "focus", label: "审查重点", placeholder: "如付款、违约、管辖、知识产权…", required: true },
        { key: "stance", label: "己方立场", placeholder: "中立 / 委托方 / 相对方", required: true },
        { key: "depth", label: "审查深度", placeholder: "快速 / 标准 / 深度", required: true },
      ];
    case "contract.rental":
    case "contract.general":
      return [
        { key: "parties", label: "双方主体", placeholder: "甲方、乙方名称", required: true },
        { key: "subject", label: "标的/交易内容", required: true, multiline: true },
        { key: "commercial", label: "价款与期限等核心商务条款", required: false, multiline: true },
      ];
    case "letter.demand":
      return [
        { key: "addressee", label: "收函对象", required: true },
        { key: "facts", label: "事实与主张", required: true, multiline: true },
        { key: "deadline", label: "履行期限", placeholder: "如收到本函后 7 日内", required: true },
      ];
    case "ppt.training":
      return [
        { key: "topic", label: "培训主题", required: true },
        { key: "audience", label: "受众/场合", required: true },
        { key: "duration", label: "时长", placeholder: "约 30 分钟", required: false },
        {
          key: "desense",
          label: "脱敏声明",
          placeholder: "已脱敏 / 仅用公开信息（培训硬核对）",
          required: true,
        },
        { key: "tone", label: "风格要求", placeholder: "专业、清楚、适合律师讲解", required: false },
      ];
    case "document.speech":
    case "document.report":
      return [
        { key: "topic", label: "主题", required: true },
        { key: "audience", label: "受众/场合", required: true },
        { key: "duration", label: "时长或篇幅", required: false },
        { key: "tone", label: "风格要求", placeholder: "专业、清楚、适合律师讲解", required: false },
      ];
    case "report.learning":
      return [
        { key: "topic", label: "调研主题", required: true },
        { key: "audience", label: "读者/用途", required: true },
        {
          key: "authority_levels",
          label: "效力层级要求",
          placeholder: "须区分立法/规章/指南/执法动态",
          required: true,
        },
        {
          key: "must_cover",
          label: "必覆盖章节",
          placeholder: "背景、制度要点、比较、实务启示…",
          required: false,
          multiline: true,
        },
        { key: "sources", label: "来源偏好", placeholder: "官库 / 指定 URL", required: false, multiline: true },
      ];
    case "report.compliance":
      return [
        { key: "topic", label: "监管问题", required: true, multiline: true },
        { key: "jurisdictions", label: "涉及管辖区", required: true },
        { key: "urls", label: "相关 URL / 官网清单", required: false, multiline: true },
        { key: "audience", label: "读者/用途", required: false },
        {
          key: "risk_domains",
          label: "关注风险域",
          placeholder: "数据隐私 / 出口管制 / 市场监管…",
          required: false,
        },
      ];
    default:
      return [
        { key: "goal", label: "要完成什么", required: true, multiline: true },
        { key: "must_include", label: "必须包含的要点", required: false, multiline: true },
        { key: "audience", label: "读者/用途", required: false },
      ];
  }
}

function researchGateLines(deliverableType: string | undefined): string[] {
  switch (deliverableType) {
    case "report.compliance":
      return [
        "请先检索/抓取 URL 卷宗并给出研究大纲，待我确认大纲后再写正文。",
        "正文须含管辖区效力矩阵与来源附录；不确定处标 [VERIFY]。",
      ];
    case "report.learning":
      return [
        "请先给出研究大纲待我确认，再起草正文。",
        "制度要点须区分效力层级；新闻/博客不得写成现行法。",
      ];
    case "ppt.training":
      return [
        "请先给出课件大纲待我确认，再生成可导出 PPT。",
        "案件材料须已脱敏；未通过脱敏核对不得出稿。",
      ];
    default:
      return [
        "请按上述交办要点执行：信息已齐则直接起草可审核交付物；仍缺关键事实时再用结构化问题追问。",
      ];
  }
}

export function buildJobIntakeDispatchPrompt(opts: {
  templateName: string;
  deliverableType?: string;
  fields: JobIntakeFieldValue[];
}): string {
  const lines: string[] = [
    `【交办】${opts.templateName}`,
  ];
  {
    const deliverableLabel = lawyerDeliverableTypeLabel(opts.deliverableType);
    if (deliverableLabel) {
      lines.push(`交付物类型：${deliverableLabel}`);
    }
  }
  lines.push("交办要点：");
  for (const f of opts.fields) {
    const v = f.value.trim();
    if (!v) {
      continue;
    }
    lines.push(`- ${f.label}：${v}`);
  }
  lines.push("");
  lines.push(...researchGateLines(opts.deliverableType));
  return lines.join("\n");
}
