/**
 * Compile-stage 规范效力: known repealed PRC titles must not be treated as in-force.
 * Independent of GCL copy. 劳动合同法 is in force and must not match 合同法.
 */

export type RepealedStatuteHit = {
  title: string;
  replaceWith: string;
};

const REPEALED: Array<{ re: RegExp; title: string; replaceWith: string }> = [
  {
    re: /(?<!劳动)(?:《(?:中华人民共和国)?合同法》|合同法(?!编))/g,
    title: "合同法",
    replaceWith: "民法典合同编",
  },
  { re: /《(?:中华人民共和国)?民法通则》|民法通则/g, title: "民法通则", replaceWith: "民法典" },
  { re: /《(?:中华人民共和国)?物权法》|物权法/g, title: "物权法", replaceWith: "民法典物权编" },
  { re: /《(?:中华人民共和国)?担保法》|担保法/g, title: "担保法", replaceWith: "民法典担保制度" },
  {
    re: /《(?:中华人民共和国)?侵权责任法》|侵权责任法/g,
    title: "侵权责任法",
    replaceWith: "民法典侵权责任编",
  },
];

export function scanRepealedStatutes(text: string): RepealedStatuteHit[] {
  const seen = new Set<string>();
  const hits: RepealedStatuteHit[] = [];
  for (const row of REPEALED) {
    row.re.lastIndex = 0;
    if (!row.re.test(text)) {
      continue;
    }
    if (seen.has(row.title)) {
      continue;
    }
    seen.add(row.title);
    hits.push({ title: row.title, replaceWith: row.replaceWith });
  }
  return hits;
}

export function formatNormValidityBody(text: string): string {
  const hits = scanRepealedStatutes(text);
  const flagged =
    hits.length > 0
      ? hits.map((h) => `- 《${h.title}》已废止，不得当有效依据；改引${h.replaceWith}。`).join("\n")
      : "- 本稿未检出已废止的合同法/民法通则/物权/担保/侵权责任法旧名。";
  return [
    "法律 > 行政法规 > 地方性法规 / 规章。特别规定优于一般规定。地方规则写明适用范围。",
    flagged,
    "查不到现行文本标【待核实】，其余分析继续。禁止编条号。",
  ].join("\n");
}

export function formatRepealedCitationWarning(
  title: string,
  article: string,
  replaceWith: string,
): string {
  return `引用《${title}》第${article}条：该法已废止，不得当有效依据。改引${replaceWith}，或标【待核实】后继续写其余部分。`;
}
