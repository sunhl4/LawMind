/**
 * Closed 12-type contract router for opinion/draft paths.
 * Independent of NC copilot copy. Never blocks. Mail/Word tracked redline do not use this.
 */

export const CLOSED_CONTRACT_TYPE_IDS = [
  "sale",
  "lease",
  "service",
  "ip",
  "security",
  "loan",
  "internet",
  "family",
  "employment",
  "real_estate",
  "construction",
  "investment",
] as const;

export type ClosedContractTypeId = (typeof CLOSED_CONTRACT_TYPE_IDS)[number];

export type ClosedContractType = {
  id: ClosedContractTypeId;
  label: string;
  secondary?: ClosedContractTypeId;
};

export const CLOSED_CONTRACT_TYPE_LABELS: Record<ClosedContractTypeId, string> = {
  sale: "买卖",
  lease: "租赁",
  service: "服务",
  ip: "知识产权",
  security: "担保",
  loan: "借贷赠与",
  internet: "互联网协议",
  family: "婚姻家事",
  employment: "劳动用工",
  real_estate: "房地产",
  construction: "建设工程",
  investment: "公司投资",
};

const RULES: Array<{ id: ClosedContractTypeId; re: RegExp }> = [
  { id: "employment", re: /劳动合同|用工|竞业限制|实习协议|劳务派遣/ },
  { id: "construction", re: /建设工程|施工合同|承包合同|工程总承包|分包合同/ },
  { id: "lease", re: /租赁合同|房屋租赁|租房|商铺出租|承租/ },
  { id: "loan", re: /借款合同|借贷|贷款合同|民间借贷|赠与合同/ },
  { id: "security", re: /保证合同|抵押合同|质押|担保函|最高额保证/ },
  { id: "family", re: /离婚协议|婚内财产|抚养协议|婚前协议|遗产分割协议/ },
  { id: "investment", re: /增资协议|股东协议|投资协议|对赌|股权转让协议|公司章程/ },
  { id: "internet", re: /SaaS|MSA|云服务|用户协议|隐私政策|平台服务协议/i },
  { id: "ip", re: /保密协议|NDA|许可协议|特许经营|技术转让|软件许可/i },
  { id: "real_estate", re: /商品房|购房合同|不动产买卖|土地出让|物业服务/ },
  { id: "sale", re: /采购合同|买卖合同|购销|供货合同|销售合同/ },
  { id: "service", re: /服务合同|委托合同|顾问协议|咨询服务|承揽合同/ },
];

export function inferClosedContractType(text: string): ClosedContractType {
  const hits: ClosedContractTypeId[] = [];
  for (const rule of RULES) {
    if (rule.re.test(text) && !hits.includes(rule.id)) {
      hits.push(rule.id);
    }
  }
  if (hits.length === 0) {
    return { id: "service", label: CLOSED_CONTRACT_TYPE_LABELS.service };
  }
  const id = hits[0];
  const secondary = hits[1];
  return {
    id,
    label: CLOSED_CONTRACT_TYPE_LABELS[id],
    ...(secondary ? { secondary } : {}),
  };
}

export function shouldInjectClosedContractType(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
): boolean {
  if (!bound || bound.pipeline === "tracked_redline") {
    return false;
  }
  return bound.id === "contract.review" || bound.id === "contract.draft";
}

export function formatClosedContractTypeLine(type: ClosedContractType): string {
  const extra = type.secondary ? `（兼${CLOSED_CONTRACT_TYPE_LABELS[type.secondary]}）` : "";
  return `类型：${type.label}${extra}。封闭 12 类，不另起第 13 类。`;
}

const MACRO_FOCUS: Record<ClosedContractTypeId, string> = {
  sale: "主体签约权限、标的规格数量、价款与交货验收是否闭环、所有权与风险转移。",
  lease: "租赁物特定化、租期、租金押金、转租维修、到期返还与添附。",
  service: "服务范围、验收标准、费用节点、成果归属、分包限制。",
  ip: "权利来源、许可范围、保密期限、侵权赔偿、权属回转。",
  security: "主债权特定、担保范围、期间、实现条件、与主合同效力绑定。",
  loan: "本金利息、期限、提前还款、担保、违约加速到期。",
  internet: "服务等级、数据与账号、费用与终止、责任上限与合规。",
  family: "身份关系、财产范围、抚养或继承安排、条款是否可强制执行。",
  employment: "用工身份、岗位期限、工资社保、解除条件、竞业与保密。",
  real_estate: "标的权属、价款按揭、交付过户、税费、违约解除。",
  construction: "承包范围工期、价款变更签证、质量保修、分包与索赔。",
  investment: "股权对价、治理与对赌、陈述保证、退出与竞业。",
};

const MESO_FOCUS: Record<ClosedContractTypeId, string> = {
  sale: "框架协议与订单、质量附件、交货计划是否互相打架。",
  lease: "房屋交接清单、物业公约、转租同意与主合同是否打架。",
  service: "SOW、验收单、报价单与主服务条款是否打架。",
  ip: "许可范围附件、开源清单、商标清单与主协议是否打架。",
  security: "主合同、最高额、抵押/质押登记文件是否打架。",
  loan: "借据、还款计划、担保合同与借款合同是否打架。",
  internet: "SLA、隐私政策、订单与平台服务协议是否打架。",
  family: "财产清单、抚养安排附件与协议正文是否打架。",
  employment: "员工手册、保密竞业附件与劳动合同是否打架。",
  real_estate: "网签、补充协议、付款节点与购房合同是否打架。",
  construction: "图纸、工程量清单、签证变更与施工合同是否打架。",
  investment: "章程、股东会决议、交割清单与投资协议是否打架。",
};

export function formatLayeredReviewBodies(type: ClosedContractType): {
  macro: string;
  meso: string;
} {
  return {
    macro: `类型：${type.label}。宏观先核：${MACRO_FOCUS[type.id]} 无全文时先列这几处待核，不要空白暂停。`,
    meso: `中观先核：${MESO_FOCUS[type.id]} 缺附件标【待核实】，仍给已读正文的意见。`,
  };
}

export function formatClosedContractTypePromptBlock(type: ClosedContractType): string {
  const extra = type.secondary
    ? `兼类：${CLOSED_CONTRACT_TYPE_LABELS[type.secondary]}。标题与实质不符时按实质。`
    : "标题与实质不符时按实质。其他类型归入最接近的一类，不要另起第 13 类。";
  return [
    "## 封闭合同类型",
    `主类型：${type.label}。${extra}`,
    "按该类的交易结构写意见或条款骨架，不要改成别类的审查清单。缺事实仍出已完成部分。",
  ].join("\n");
}
