/**
 * Compile-stage 要素提取: oral narrative → structured 九类 facts.
 * Independent of GCL copy. Never blocks; missing slots stay 待补充.
 */

export type LegalElementSlot =
  | "subject"
  | "act"
  | "time"
  | "place"
  | "object"
  | "result"
  | "cause"
  | "mensRea"
  | "procedure";

export const LEGAL_ELEMENT_LABELS: Record<LegalElementSlot, string> = {
  subject: "主体",
  act: "行为",
  time: "时间",
  place: "地点",
  object: "对象",
  result: "结果",
  cause: "因果",
  mensRea: "主观",
  procedure: "程序",
};

export type ExtractedLegalElements = {
  oral: string[];
  facts: string[];
  slots: Partial<Record<LegalElementSlot, string>>;
};

const ORAL_TRANSFORMS: Array<{ re: RegExp; fact: string; slot: LegalElementSlot }> = [
  { re: /一直拖着?不[还付给]|拖着不还/, fact: "履行期限届满后未返还或支付", slot: "act" },
  { re: /拖欠(货款|工程款|租金)/, fact: "对方未按约支付到期款项", slot: "act" },
  { re: /拖欠工资|一直不发工资/, fact: "用人单位未及时足额支付劳动报酬", slot: "act" },
  { re: /被?(公司|单位)?(开除|辞退)|解除劳动合同/, fact: "用人单位单方解除劳动合同", slot: "act" },
  { re: /不让上班|停工停职/, fact: "用人单位未提供劳动条件或停工", slot: "act" },
  { re: /口头答应|说好了(还|给)/, fact: "存在口头约定，书面条款待核", slot: "act" },
  { re: /希望.*(起诉|告|要回|赔偿)/, fact: "委托人表示希望通过法律途径主张权利", slot: "result" },
];

const STRIP_EVAL = /(不讲信用|肯定违法|太坑了|黑心|诈骗犯)/g;

export function extractLegalElements(instruction: string): ExtractedLegalElements {
  const _text = instruction.replace(STRIP_EVAL, "").trim();
  const oral: string[] = [];
  const facts: string[] = [];
  const slots: Partial<Record<LegalElementSlot, string>> = {};
  for (const row of ORAL_TRANSFORMS) {
    if (row.re.test(instruction)) {
      oral.push(instruction.match(row.re)?.[0] ?? row.re.source);
      facts.push(row.fact);
      slots[row.slot] = row.fact;
    }
  }
  const party = instruction.match(
    /(?:原告|被告|甲方|乙方|用人单位|劳动者)[：:]\s*([^\n，。;；]{1,40})/,
  );
  if (party?.[1]) {
    slots.subject = party[1].trim();
  }
  const when = instruction.match(/(\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)/);
  if (when?.[1]) {
    slots.time = when[1].replace(/\s+/g, "");
  }
  return { oral, facts, slots };
}

export function formatLegalElementsBody(extracted: ExtractedLegalElements): string {
  const slotLines = (Object.keys(LEGAL_ELEMENT_LABELS) as LegalElementSlot[]).map((slot) => {
    const value = extracted.slots[slot];
    return `- ${LEGAL_ELEMENT_LABELS[slot]}：${value ?? "【待补充】"}`;
  });
  const facts =
    extracted.facts.length > 0
      ? extracted.facts.map((f) => `- ${f}`).join("\n")
      : "- 【待补充】可证明的行为、时间、结果";
  return [
    "口语已还原为要件事实的，直接用；评价性用语已剔除。",
    "已提取：",
    facts,
    "九类：",
    ...slotLines,
  ].join("\n");
}

export function hasExtractedLegalFacts(extracted: ExtractedLegalElements): boolean {
  return extracted.facts.length > 0 || Object.keys(extracted.slots).length > 0;
}
