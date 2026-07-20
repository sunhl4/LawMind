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
        { key: "stance", label: "己方立场", placeholder: "甲方 / 乙方 / 中立", required: true },
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
    case "document.speech":
    case "document.report":
      return [
        { key: "topic", label: "主题", required: true },
        { key: "audience", label: "受众/场合", required: true },
        { key: "duration", label: "时长或篇幅", required: false },
        { key: "tone", label: "风格要求", placeholder: "专业、清楚、适合律师讲解", required: false },
      ];
    default:
      return [
        { key: "goal", label: "要完成什么", required: true, multiline: true },
        { key: "must_include", label: "必须包含的要点", required: false, multiline: true },
        { key: "audience", label: "读者/用途", required: false },
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
  lines.push(
    "请按上述交办要点执行：信息已齐则直接起草可审核交付物并进入文书台；仍缺关键事实时再用结构化问题追问，不要空聊。",
  );
  return lines.join("\n");
}
