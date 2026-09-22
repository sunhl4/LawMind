/**
 * 快问分诊档：可先答 / 要干活 / 先别做不可逆动作.
 * Always still answers. Never a confirm page or STOP.
 */

export type QuickTriageBand = "answer" | "work" | "hold_irreversible";

export function inferQuickTriageBand(instruction: string): QuickTriageBand {
  if (/现在就(起诉|报警|发媒体|发微博|公开曝光)|网上曝光|先把对方捅出去/.test(instruction)) {
    return "hold_irreversible";
  }
  if (
    /(经济补偿|赔偿金|违法解除|加班费|双倍工资|拖欠工资|写起诉状|审查.{0,6}合同|起草.{0,4}(函|合同)|计算上诉期)/.test(
      instruction,
    )
  ) {
    return "work";
  }
  return "answer";
}

export function formatQuickTriageBandLine(instruction: string): string {
  const band = inferQuickTriageBand(instruction);
  if (band === "hold_irreversible") {
    return "分诊：先别做不可逆动作（起诉/公开）。分析仍给出，不要空白暂停。";
  }
  if (band === "work") {
    return "分诊：要干活（计算、审查或文书）。本回合仍先给结论和缺口。";
  }
  return "分诊：可先答。能检索则检索；缺材料标【待核实】。";
}
