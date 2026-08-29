/**
 * Solo「5 分钟合同审查」短路径 — 立场/深度 → 结构化交办 prompt。
 * 对标 WorkBuddy 入口：中立/委托方/相对方 × 快速/标准/深度。
 */

import { buildJobIntakeDispatchPrompt } from "./lawmind-job-intake";

export type ContractReviewStance = "neutral" | "client" | "counterparty";
export type ContractReviewDepth = "quick" | "standard" | "deep";

export const CONTRACT_REVIEW_STANCE_OPTIONS: Array<{
  id: ContractReviewStance;
  label: string;
  /** 写入交办「己方立场」的律师可读值 */
  intakeValue: string;
}> = [
  { id: "neutral", label: "中立", intakeValue: "中立" },
  { id: "client", label: "委托方", intakeValue: "委托方（保护我方利益）" },
  { id: "counterparty", label: "相对方", intakeValue: "相对方视角（预判对方抗辩）" },
];

export const CONTRACT_REVIEW_DEPTH_OPTIONS: Array<{
  id: ContractReviewDepth;
  label: string;
  hint: string;
}> = [
  { id: "quick", label: "快速", hint: "挑最关键的 3–5 个风险，约数分钟" },
  { id: "standard", label: "标准", hint: "全面审查并起草可签批意见书" },
  { id: "deep", label: "深度", hint: "逐条细查，可升完整审查专案组" },
];

export function stanceIntakeValue(stance: ContractReviewStance): string {
  return (
    CONTRACT_REVIEW_STANCE_OPTIONS.find((o) => o.id === stance)?.intakeValue ?? "中立"
  );
}

export function depthInstruction(depth: ContractReviewDepth): string {
  switch (depth) {
    case "quick":
      return "审查深度：快速。只列出最高优先级的 3–5 个风险点与修改建议，正文可短，但须可签批；勿展开冗长论证。";
    case "deep":
      return "审查深度：深度。逐条细查关键条款，风险分级（高/中/低），必要时建议升「完整审查」专案组。";
    default:
      return "审查深度：标准。按合同审查意见交付物规范全面审查，输出完整意见书。";
  }
}

const LAWYER_PREFS_MAX = 800;

export function formatLawyerPrefsBlock(lawyerPrefs?: string): string {
  const text = lawyerPrefs?.trim() ?? "";
  if (!text) {
    return "";
  }
  const cut = text.length > LAWYER_PREFS_MAX ? `${text.slice(0, LAWYER_PREFS_MAX)}…` : text;
  return `\n\n【已采纳偏好】\n${cut}`;
}

export function buildContractFastLanePrompt(opts: {
  materials: string;
  focus?: string;
  stance: ContractReviewStance;
  depth: ContractReviewDepth;
  lawyerPrefs?: string;
}): string {
  const materials = opts.materials.trim() || "（已在对话中引用合同文件，请直接分析引用材料）";
  const focus = opts.focus?.trim() || "付款、违约、管辖、责任限制、终止与争议解决";
  const base = buildJobIntakeDispatchPrompt({
    templateName: "5 分钟合同审查",
    deliverableType: "contract.review",
    fields: [
      { key: "materials", label: "合同/材料说明", value: materials },
      { key: "focus", label: "审查重点", value: focus },
      { key: "stance", label: "己方立场", value: stanceIntakeValue(opts.stance) },
    ],
  });
  return `${base}\n\n${depthInstruction(opts.depth)}${formatLawyerPrefsBlock(opts.lawyerPrefs)}`;
}
