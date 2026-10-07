/**
 * Shared lawyer-industry kernel fixtures.
 *
 * Task TYPES come from public legal NLP benches. Texts are original Chinese
 * employment / sales / NDA / license snippets, not copies of those corpora.
 * Not a lawyer-graded manuscript set.
 */
import { emptyFactorState, ingestToolResult, type FactorState } from "./factor-state.js";

export type CuadClause = {
  label: string;
  anchor: string;
  outcome: string;
  excerpt: string;
  absent: string;
};

/** CUAD-style labels. Outcome ids are Chinese so a latin-id + 4-CJK shortcut cannot fake a span. */
export const CUAD_CLAUSES: readonly CuadClause[] = [
  {
    label: "termination_for_convenience",
    anchor: "clause:解除",
    outcome: "提前三十日书面通知解除",
    excerpt: "甲方有权提前三十日书面通知解除本合同，且无需说明理由。",
    absent: "本合同自双方盖章之日起生效。",
  },
  {
    label: "governing_law",
    anchor: "clause:管辖",
    outcome: "适用中华人民共和国法律",
    excerpt: "本合同适用中华人民共和国法律。因本合同引起的争议提交上海仲裁委员会仲裁。",
    absent: "双方应按约全面履行各自义务。",
  },
  {
    label: "liquidated_damages",
    anchor: "clause:违约金",
    outcome: "每日万分之五",
    excerpt: "逾期付款的，乙方应按欠付金额每日万分之五向甲方支付违约金。",
    absent: "货款应于交付后三十日内付清。",
  },
  {
    label: "non-compete",
    anchor: "clause:竞业限制",
    outcome: "离职后两年内不得",
    excerpt: "劳动者离职后两年内不得在与本单位生产同类产品的其他用人单位任职。",
    absent: "劳动者应按时完成工作任务。",
  },
  {
    label: "change_of_control",
    anchor: "clause:控制权变更",
    outcome: "控制权发生变更",
    excerpt: "甲方控制权发生变更的，应在三十日内书面通知乙方，乙方有权解除。",
    absent: "甲方变更通知地址的，应书面告知乙方。",
  },
  {
    label: "anti-assignment",
    anchor: "clause:转让",
    outcome: "事先书面同意",
    excerpt: "任何一方未经对方事先书面同意，不得转让本合同项下的权利义务。",
    absent: "本合同对双方及其合法承继人具有约束力。",
  },
  {
    label: "cap_on_liability",
    anchor: "clause:责任上限",
    outcome: "合同总价为限",
    excerpt: "一方对另一方的赔偿责任以本合同项下已付合同总价为限，间接损失不予赔偿。",
    absent: "一方违约的，应赔偿对方因此遭受的损失。",
  },
  {
    label: "audit_rights",
    anchor: "clause:查账",
    outcome: "查阅被许可方与本许可有关的账册",
    excerpt: "许可方有权在合理通知后查阅被许可方与本许可有关的账册和记录。",
    absent: "被许可方应按季度提交使用报告。",
  },
  {
    label: "ip_ownership_assignment",
    anchor: "clause:知识产权",
    outcome: "知识产权归甲方所有",
    excerpt: "乙方在履行本合同过程中产生的职务成果，其知识产权归甲方所有。",
    absent: "双方各自保留签约前已有的知识产权。",
  },
  {
    label: "license_grant",
    anchor: "clause:许可",
    outcome: "非独占许可",
    excerpt: "甲方授予乙方一项不可转让的非独占许可，仅限于在约定区域内使用本软件。",
    absent: "乙方应妥善保管甲方提供的技术资料。",
  },
  {
    label: "exclusivity",
    anchor: "clause:独家",
    outcome: "独家经销",
    excerpt: "在协议期限内，甲方指定乙方为产品在华东地区的独家经销商。",
    absent: "乙方可在其经营场所销售甲方产品。",
  },
  {
    label: "most_favored_nation",
    anchor: "clause:最惠",
    outcome: "不得优于给予乙方的条件",
    excerpt: "甲方给予任何第三方的价格不得优于给予乙方的条件，否则应自动适用于乙方。",
    absent: "价格由双方另行书面确认。",
  },
  {
    label: "minimum_commitment",
    anchor: "clause:最低采购",
    outcome: "最低采购量为人民币伍佰万元",
    excerpt: "乙方每一合同年度的最低采购量为人民币伍佰万元。未完成的，按差额补足。",
    absent: "采购数量以订单为准。",
  },
  {
    label: "volume_restriction",
    anchor: "clause:数量限制",
    outcome: "不得超过附件一约定的年度上限",
    excerpt: "乙方转售数量不得超过附件一约定的年度上限。",
    absent: "乙方应按订单数量收货。",
  },
  {
    label: "insurance",
    anchor: "clause:保险",
    outcome: "投保产品责任险",
    excerpt: "乙方应投保产品责任险，保险金额不低于人民币壹仟万元，并在保单中列明甲方为受益人。",
    absent: "货物毁损风险自交付时转移。",
  },
  {
    label: "warranty_duration",
    anchor: "clause:质保",
    outcome: "二十四个月",
    excerpt: "设备质保期为验收合格之日起二十四个月。质保期内因质量问题免费维修。",
    absent: "甲方应在交付时提供合格证明。",
  },
  {
    label: "notice_period_to_terminate_renewal",
    anchor: "clause:续展通知",
    outcome: "届满前六十日书面通知",
    excerpt: "任何一方拟不续展的，应在期限届满前六十日书面通知对方，否则自动续展一年。",
    absent: "合同期限为三年，自生效日起算。",
  },
  {
    label: "post-termination_services",
    anchor: "clause:终止后服务",
    outcome: "九十日内继续提供过渡协助",
    excerpt: "合同终止后，乙方应在九十日内继续提供过渡协助，费用按本合同单价结算。",
    absent: "合同终止后双方不再负有合同义务。",
  },
  {
    label: "third_party_beneficiary",
    anchor: "clause:第三人",
    outcome: "第三方不得依本合同主张权利",
    excerpt: "除本合同明确约定外，任何第三方不得依本合同主张权利。",
    absent: "本合同自双方盖章之日起生效。",
  },
  {
    label: "effective_date",
    anchor: "clause:生效",
    outcome: "自双方盖章之日起生效",
    excerpt: "本合同一式两份，自双方盖章之日起生效。",
    absent: "附件与本合同具有同等效力。",
  },
];

export const LABOR_CONTRACT = [
  "劳动合同",
  "甲方：上海示例科技有限公司（以下简称“公司”）",
  "乙方：张三",
  "月工资人民币壹万伍仟元整。",
  "乙方在甲方工作年限为三年。",
  "解除劳动合同的，甲方依法支付经济补偿。",
].join("\n");

export const NDA = [
  "保密协议",
  "披露方：上海示例科技有限公司",
  "接收方：杭州示例贸易有限公司",
  "接收方不得向任何第三方披露保密信息。",
  "保密义务于本协议终止后三年内继续有效。",
  "接收方不得对披露方软件进行反向工程。",
].join("\n");

export const LABOR_47_SNIPPET =
  "第四十七条 经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。";

export const LAW_BENCH_COMPENSATION = [
  {
    id: "N-3y-15k",
    inputs: { yearsOfService: 3, monthlyWageYuan: 15_000, kind: "N" as const },
    expected: 45_000,
  },
  {
    id: "2N-3y-10k",
    inputs: { yearsOfService: 3, monthlyWageYuan: 10_000, kind: "2N" as const },
    expected: 60_000,
  },
  {
    id: "N+1-2y-8k",
    inputs: { yearsOfService: 2, monthlyWageYuan: 8_000, kind: "N+1" as const },
    expected: 24_000,
  },
  {
    id: "high-wage-cap",
    inputs: {
      yearsOfService: 20,
      monthlyWageYuan: 50_000,
      localAverageWageYuan: 10_000,
      kind: "N" as const,
    },
    expected: 360_000,
  },
] as const;

export const NLI_ENTAILMENT = {
  anchor: "clause:保密期限",
  outcome: "终止后三年内继续有效",
  span: "保密义务于本协议终止后三年内继续有效。",
} as const;

export const NLI_CONTRADICTION = [
  {
    anchor: "clause:反向工程",
    outcomeId: "反向工程",
    conclusion: "接收方不得反向工程",
    span: "接收方不得对披露方软件进行反向工程。",
  },
  {
    anchor: "clause:反向工程",
    outcomeId: "反向工程",
    conclusion: "接收方不得反向工程",
    span: "接收方有权对披露方软件进行反向工程。",
  },
] as const;

export const NLI_NOT_MENTIONED = {
  anchor: "clause:强制披露通知",
  outcome: "应事先书面通知披露方",
} as const;

export const MAUD_MAE = [
  {
    anchor: "clause:重大不利变化",
    outcomeId: "mae_general",
    conclusion: "发生重大不利变化即可终止",
    span: "发生重大不利变化的，买方有权终止。",
  },
  {
    anchor: "clause:重大不利变化",
    outcomeId: "mae_carveout",
    conclusion: "疫情不属于重大不利变化",
    span: "疫情及其政府应对措施不构成重大不利变化。",
  },
] as const;

export const LABOR_JUDGMENT_PROSE =
  "综合证据，我方主张继续履行更符合安排；若不能继续履行，则两种路径都写入意见。经济补偿为 45000 元。";

export function ingestClause(anchor: string, outcome: string, span: string): FactorState {
  const state = emptyFactorState();
  ingestToolResult(state, "draft_worker", {
    anchor,
    outcomeId: outcome,
    span,
    conclusion: outcome,
  });
  return state;
}
