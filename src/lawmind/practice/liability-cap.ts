/**
 * 责任上限四个位置 + 破局条款. Anthropic playbook structure, independent copy.
 * Opinion path only. Never blocks. Does not change mail/Word locks.
 */

export type LiabilityCapFill = {
  directCap: string;
  consequential: string;
  carveOuts: string;
  base: string;
  breakDeal: string;
  neverHits: string[];
};

const NEVER_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: /无限责任|不设上限|责任不受限制/, label: "无限责任" },
  { re: /排除人身损害责任|免除故意或重大过失/, label: "排除人身/故意/重大过失责任" },
  { re: /仅约定对方所在地(?:人民法院|管辖)/, label: "仅对方所在地单方管辖" },
];

export function extractLiabilityCapFill(instruction: string): LiabilityCapFill {
  const neverHits = NEVER_HINTS.filter((row) => row.re.test(instruction)).map((row) => row.label);
  const unlimited = neverHits.includes("无限责任");
  return {
    directCap: unlimited
      ? "交办写无限责任：命中永不接受。改成可预期上限。"
      : "直接损失：默认应有上限（金额待核条款）。",
    consequential: /间接损失|可得利益/.test(instruction)
      ? "间接/可得利益：交办已点名，按排除或单独限额核条款。"
      : "间接/可得利益：默认排除，除非交办要保留。",
    carveOuts: "人身、故意、重大过失、知识产权、数据泄露作 carve-out，不进普通上限。",
    base: /合同总额|已收价款|年费/.test(instruction)
      ? "基数：按交办已写的合同总额/已收价款核定义。"
      : "基数：【待补充】已收价款或合同总额；金额不是唯一位置。",
    breakDeal: "先核破局：付款/验收闭环、单方解除、争议解决。无档案时这三处仍要审完。",
    neverHits,
  };
}

export function formatLiabilityCapBody(fill: LiabilityCapFill): string {
  const never =
    fill.neverHits.length > 0
      ? `永不接受命中：${fill.neverHits.join("、")}。落地：改这几个字，不要只写「存在风险」。`
      : "交办未点名永不接受项；按开箱默认继续审。";
  return [
    `1. 直接损失上限：${fill.directCap}`,
    `2. 间接/可得利益：${fill.consequential}`,
    `3. carve-out：${fill.carveOuts}`,
    `4. 基数定义：${fill.base}`,
    `破局条款：${fill.breakDeal}`,
    never,
  ].join("\n");
}
