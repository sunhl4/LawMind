/**
 * Compile-stage 证据论证链: named exhibits from the instruction only.
 * Missing evidence is 待补; never invent files. Does not stop the draft.
 */

export type EvidenceWeight = "强" | "中" | "弱" | "待补";

export type EvidenceChainLink = {
  claim: string;
  element: string;
  factToProve: string;
  evidence: string;
  weight: EvidenceWeight;
};

const PLACEHOLDER_EVIDENCE = "【待补充】";

const NAMED_EVIDENCE: Array<{ re: RegExp; name: string; weight: Exclude<EvidenceWeight, "待补"> }> =
  [
    { re: /工资流水|银行流水/, name: "工资或银行流水", weight: "中" },
    { re: /劳动合同(?!法)/, name: "劳动合同", weight: "中" },
    { re: /聊天记录|微信记录|微信聊天/, name: "聊天记录", weight: "中" },
    { re: /考勤记录|打卡记录/, name: "考勤记录", weight: "中" },
    { re: /转账凭证|付款凭证/, name: "转账凭证", weight: "中" },
    { re: /发票/, name: "发票", weight: "中" },
    { re: /判决书|裁定书/, name: "裁判文书", weight: "强" },
    { re: /病历|诊断证明/, name: "病历或诊断证明", weight: "中" },
    { re: /录音/, name: "录音", weight: "中" },
    { re: /合同文本|采购合同|销售合同/, name: "合同文本", weight: "中" },
  ];

export function extractNamedEvidence(
  instruction: string,
): Array<{ name: string; weight: Exclude<EvidenceWeight, "待补"> }> {
  const out: Array<{ name: string; weight: Exclude<EvidenceWeight, "待补"> }> = [];
  const seen = new Set<string>();
  for (const row of NAMED_EVIDENCE) {
    if (!row.re.test(instruction) || seen.has(row.name)) {
      continue;
    }
    seen.add(row.name);
    out.push({ name: row.name, weight: row.weight });
  }
  return out;
}

export function extractEvidenceChain(
  instruction: string,
  elements?: Array<{ element: string; facts: string }>,
): EvidenceChainLink[] {
  const named = extractNamedEvidence(instruction);
  const slots =
    elements && elements.length > 0
      ? elements
      : [{ element: "【构成要件】", facts: "【待证事实】" }];
  if (named.length === 0) {
    return slots.map((slot) => ({
      claim: slot.element,
      element: slot.element,
      factToProve: slot.facts,
      evidence: PLACEHOLDER_EVIDENCE,
      weight: "待补" as const,
    }));
  }
  return named.map((ev, i) => {
    const slot = slots[Math.min(i, slots.length - 1)] ?? slots[0];
    return {
      claim: slot.element,
      element: slot.element,
      factToProve: slot.facts,
      evidence: ev.name,
      weight: ev.weight,
    };
  });
}

export function formatEvidenceChainBlock(links: EvidenceChainLink[]): string {
  const rows = links.map(
    (link, i) =>
      `${i + 1}. ${link.evidence}——主张/要件：${link.element}——待证事实：${link.factToProve}——证明力：${link.weight}`,
  );
  return ["按论证链列，不要只有文件名。一项证据可挂多个要件。缺证写待补，不停工。", ...rows].join(
    "\n",
  );
}
