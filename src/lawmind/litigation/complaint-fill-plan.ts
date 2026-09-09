/**
 * 要素式起诉状 fill-plan：线性字段，不走会打烂表格的 markdown 表。
 * 母版克隆的等价物：固定栏目 + 占位，Word 按段落渲染。
 */

import { extractEvidenceChain } from "../reasoning/evidence-chain.js";
import { extractLegalElements } from "../reasoning/legal-elements.js";

export type ComplaintElementRow = {
  element: string;
  facts: string;
  evidence: string;
  weight?: string;
};

export type ComplaintFillPlan = {
  court: string;
  plaintiffs: string;
  defendants: string;
  claims: string[];
  elements: ComplaintElementRow[];
  closingDate: string;
};

const PLACEHOLDER = (label: string): string => `【${label}】`;

export function emptyComplaintFillPlan(): ComplaintFillPlan {
  return {
    court: PLACEHOLDER("人民法院名称"),
    plaintiffs: PLACEHOLDER("原告名称、住所、证件"),
    defendants: PLACEHOLDER("被告名称、住所、证件"),
    claims: [PLACEHOLDER("诉讼请求一"), PLACEHOLDER("诉讼请求二")],
    elements: [
      {
        element: PLACEHOLDER("构成要件一"),
        facts: PLACEHOLDER("对应事实"),
        evidence: PLACEHOLDER("证据名称或待补充"),
      },
      {
        element: PLACEHOLDER("构成要件二"),
        facts: PLACEHOLDER("对应事实"),
        evidence: PLACEHOLDER("证据名称或待补充"),
      },
    ],
    closingDate: PLACEHOLDER("具状日期"),
  };
}

function firstCapture(re: RegExp, text: string): string | undefined {
  const m = re.exec(text);
  const raw = m?.[1]?.trim();
  return raw && raw.length > 0 && raw.length < 80 ? raw : undefined;
}

/** Pull obvious 原告/被告/法院 from the instruction; never invent the rest. */
export function extractComplaintFillPlan(instruction: string): ComplaintFillPlan {
  const plan = emptyComplaintFillPlan();
  const court = firstCapture(/(?:此致|管辖|向)\s*([^\s，。,.]{2,30}人民法院)/, instruction);
  if (court) {
    plan.court = court;
  }
  const plaintiff = firstCapture(/原告[：:]\s*([^\n，。;；]{1,40})/, instruction);
  if (plaintiff) {
    plan.plaintiffs = plaintiff;
  }
  const defendant = firstCapture(/被告[：:]\s*([^\n，。;；]{1,40})/, instruction);
  if (defendant) {
    plan.defendants = defendant;
  }
  const extracted = extractLegalElements(instruction);
  if (extracted.facts[0] && plan.elements[0]) {
    plan.elements[0] = {
      ...plan.elements[0],
      facts: extracted.facts[0],
      element: extracted.slots.act ? "给付或解除等构成" : plan.elements[0].element,
    };
  }
  const chain = extractEvidenceChain(instruction, plan.elements);
  for (let i = 0; i < plan.elements.length; i++) {
    const link = chain[i];
    const row = plan.elements[i];
    if (!link || !row) {
      continue;
    }
    plan.elements[i] = {
      ...row,
      evidence: link.evidence,
      weight: link.weight,
    };
  }
  return plan;
}

export function formatComplaintPartyBlock(plan: ComplaintFillPlan): string {
  return [`原告：${plan.plaintiffs}`, `被告：${plan.defendants}`].join("\n");
}

export function formatComplaintClaimsBlock(plan: ComplaintFillPlan): string {
  return ["请求判令：", ...plan.claims.map((c, i) => `${i + 1}. ${c}`)].join("\n");
}

export function formatComplaintFactsBlock(plan: ComplaintFillPlan): string {
  const rows = plan.elements.map(
    (row, i) => `${i + 1}. 要件：${row.element}\n   事实：${row.facts}\n   证据：${row.evidence}`,
  );
  return ["按请求权构成要件陈述（线性栏目，不用表格）：", ...rows].join("\n");
}

export function formatComplaintEvidenceBlock(plan: ComplaintFillPlan): string {
  const rows = plan.elements.map(
    (row, i) =>
      `${i + 1}. ${row.evidence}——要件：${row.element}——待证事实：${row.facts}——证明力：${row.weight ?? "待补"}`,
  );
  return [...rows, "缺证写待补，不停工。"].join("\n");
}

export function formatComplaintClosingBlock(plan: ComplaintFillPlan): string {
  return `此致\n${plan.court}\n\n具状人：${plan.plaintiffs}\n日期：${plan.closingDate}`;
}
