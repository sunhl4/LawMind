/**
 * Proposition matrix for research memos: issue → forward / reverse / short query.
 * Fills the 检索栏目 instead of leaving empty placeholders when the instruction already states the issue.
 */

export type QueryMatrix = {
  issue: string;
  forward: string;
  reverse: string;
  queryTerms: string;
};

const ISSUE_HINTS: Array<{ re: RegExp; forward: string; reverse: string; terms: string }> = [
  {
    re: /违约责任|违约金/,
    forward: "违约金约定有效且可请求支付",
    reverse: "约定无效、过分高于损失或违约金调整",
    terms: "违约金 调整 民法典 过分高于",
  },
  {
    re: /解除劳动合同|违法解除|经济补偿/,
    forward: "解除违法，劳动者可主张赔偿金或经济补偿",
    reverse: "解除合法或双方协商解除",
    terms: "违法解除 赔偿金 经济补偿 劳动合同法",
  },
  {
    re: /管辖|仲裁条款|或裁或诉/,
    forward: "争议解决条款有效，应按约定管辖或仲裁",
    reverse: "条款无效、未约定或或裁或诉",
    terms: "仲裁协议 效力 或裁或诉 管辖",
  },
  {
    re: /诉讼时效|时效抗辩/,
    forward: "请求权仍在诉讼时效期间内",
    reverse: "时效已过且无中断中止",
    terms: "诉讼时效 中断 民法典 抗辩",
  },
];

export function buildQueryMatrix(instruction: string): QueryMatrix {
  const trimmed = instruction.replace(/\s+/g, " ").trim().slice(0, 80);
  for (const row of ISSUE_HINTS) {
    if (row.re.test(instruction)) {
      return {
        issue: trimmed || "法律争点",
        forward: row.forward,
        reverse: row.reverse,
        queryTerms: row.terms,
      };
    }
  }
  return {
    issue: trimmed || "法律争点",
    forward: `支持「${trimmed || "交办问题"}」的构成与请求权`,
    reverse: "需排除的近邻案型或相反构成",
    queryTerms: "名称+可能条号 结构事实 现行有效",
  };
}

export function formatQueryMatrixBody(matrix: QueryMatrix, retrieved: boolean): string {
  const retrievalLine = retrieved
    ? "本回合已有检索结果，对位后再写现行法条与类案。"
    : "本回合尚无检索命中：先按下列命题试检 1–2 条，再扩检。无工具则保留栏目并标【待核实】，不编条号。";
  return [
    retrievalLine,
    `争点：${matrix.issue}`,
    `正向命题：${matrix.forward}`,
    `反向命题：${matrix.reverse}`,
    `查询词：${matrix.queryTerms}`,
  ].join("\n");
}
