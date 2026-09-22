export type CaseFocusContext = {
  title: string;
  hint: string;
  query?: string;
  section?: "core-issues" | "risk-notes" | "artifacts" | "case-md";
};

export type CaseDraftVariant = "conservative" | "standard" | "assertive";

export function buildCaseFocusDraft(context: CaseFocusContext, variant: CaseDraftVariant): string {
  const toneLead =
    variant === "conservative"
      ? "建议先做最小必要补充："
      : variant === "assertive"
        ? "建议优先推动形成明确处理结论："
        : "建议补充案件记录：";
  if (context.section === "core-issues") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议尽快明确的核心法律争点：" : "下一步需要澄清的法律问题："
    }\n- ${
      variant === "conservative" ? "暂不确定但需记录的边界：" : "建议补充的判断标准或目标："
    }`;
  }
  if (context.section === "artifacts") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议立即推进的交付物：" : "计划新增或更新的交付物："
    }\n- ${variant === "conservative" ? "当前仍需等待的前置条件：" : "为交付准备需补齐的说明："}`;
  }
  if (context.section === "case-md") {
    return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
      variant === "assertive" ? "建议立即明确的目标或底线：" : "建议先明确的目标或底线："
    }\n- ${variant === "conservative" ? "当前尚不宜推进的原因：" : "下一步策略动作："}`;
  }
  return `${toneLead}\n- 阻塞主题：${context.title}\n- 当前原因：${context.hint}\n- ${
    variant === "assertive" ? "建议立即补齐的信息或证据：" : "仍待补齐的信息或证据："
  }\n- ${variant === "conservative" ? "当前已知风险边界：" : "补充完成后的下一步动作："}`;
}
