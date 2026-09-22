/**
 * 检查单项判定表（G0）——**150 项的完整分级**，不是抽样示范。
 *
 * 规模（2026-09-21 逐项实测）：
 *   - `platform/word-revision-packs.ts`（9 个合同族）…… **125** 项
 *   - `deliverables/verification-checklist.ts`（6 个 spec）… **25** 项
 *   - 合计 **150** 项
 *
 * 定级方法（每项按顺序过四问，**第一问命中即定级**）：
 *   Q1 答案是否完全由「正文 + 检索快照 + 门禁事实」确定性推出？ → `machine`
 *   Q2 是否涉及法律判断，但判据可逐条枚举、证据包里能找到支撑痕迹？ → `judge`
 *   Q3 是否需要商业取舍 / 价值权衡 / 办案策略（不同律师会给出不同答案）？ → `lawyer`
 *   Q4 不确定 → `judge`（**保守方向**：宁可多问模型，不可少判）
 *
 * ⚠️ 覆盖诚实（本文档最重要的一条）：
 * 实测 `machine` **21 项 / 150 项 = 14%**，**低于** `LAWMIND-DECISION-LAYER-PRODUCTION-PLAN.md`
 * 原先假设的 30%。原因不是分级保守，而是**清单的性质**：125 个 word-revision 条项是
 * 「看/改/停」实质审查提示（如"对赌：现金补偿或回购；义务主体是股东还是目标公司"），
 * 天然需要语义判断；而仓库里真正机械化的部分在 `lint/`，它**本来就在独立运行**。
 *
 * 因此：`machine` 只登记**有真实规则支撑**的项。没有规则支撑的项一律留 `judge`——
 * 不为了凑覆盖率发明规则（新规则要走 G4 的法律顾问验收，I7）。
 * 想把 14% 提到 30%+ 的唯一正当路径是 G4 写新规则，不是在这里改分级。
 */

import {
  verificationKey,
  wordRevisionKey,
  type ChecklistItemJudgment,
  type JudgmentTable,
} from "./judgment-tier.js";

type Entry = ChecklistItemJudgment;

function machine(verifier: string, rationale: string): Entry {
  return { tier: "machine", verifier, rationale };
}

function lawyer(lawyerReason: string, rationale: string): Entry {
  return { tier: "lawyer", lawyerReason, rationale };
}

function judge(rationale: string): Entry {
  return { tier: "judge", rationale };
}

// ─────────────────────────────────────────────
// machine：21 项（有真实规则支撑）
// ─────────────────────────────────────────────

const MACHINE_ENTRIES: JudgmentTable = {
  [verificationKey("contract-review-v1", "citations")]: machine(
    "citations.subset",
    "引用 ID 是否在本次检索快照中，由 `gates.citationIntegrityOk` 确定性给出——不需要阅读语义。",
  ),
  [verificationKey("learning-brief-v1", "citations")]: machine(
    "citations.subset",
    "同上：引用可溯源性是集合包含判断，可完全机械核对。",
  ),
  [verificationKey("general-v1", "citations")]: machine(
    "citations.subset",
    "同上：引用可溯源性是集合包含判断，可完全机械核对。",
  ),
  [verificationKey("compliance-dossier-v1", "sources")]: machine(
    "citations.used",
    "来源是否被正文实际引用，由 `pack.citations[].usedInHeadings` 确定性给出。",
  ),
  [verificationKey("training-ppt-v1", "sources")]: machine(
    "citations.used",
    "同上：来源被使用与否可机械核对。",
  ),
  [verificationKey("demand-letter-v1", "facts")]: machine(
    "graph.authority_used",
    "「关键事实与证据指向一致」可退化为图上的可达性：每个争点是否引用了依据。",
  ),
  [verificationKey("contract-review-v1", "parties")]: machine(
    "parties.consistent",
    "当事人名称一致性由 `consistency.party_pair` 规则核对，属字符串层面事实。",
  ),
  [verificationKey("demand-letter-v1", "claim")]: machine(
    "amounts.case_consistent",
    "主张金额可核对性 = 大写与小写一致，由 `consistency.amount_case` 给出。",
  ),
  [verificationKey("demand-letter-v1", "deadline")]: machine(
    "dates.ordered",
    "履行期限表述准确性中的日期自洽部分，由 `consistency.date_order` 给出。",
  ),
  [verificationKey("general-v1", "placeholders")]: machine(
    "placeholders.closed",
    "「无未处理的占位符」由 `placeholder.open` 规则确定性给出。",
  ),
  [wordRevisionKey("eq.dispute")]: machine(
    "forum.form_valid",
    "「管辖/仲裁」的形式有效性（禁止同时约定）由 `form.or_arbitrate_or_sue` / `form.jurisdiction` + `clause.dispute_missing` 判定。",
  ),
  [wordRevisionKey("ma.dispute")]: machine(
    "forum.form_valid",
    "同上：形式有效性是规则判断，不涉及商业取舍。",
  ),
  [wordRevisionKey("pr.dispute")]: machine(
    "forum.form_valid",
    "同上：形式有效性是规则判断，不涉及商业取舍。",
  ),
  [wordRevisionKey("constr.dispute")]: machine(
    "forum.form_valid",
    "同上：形式有效性是规则判断，不涉及商业取舍。",
  ),
  [wordRevisionKey("loan.dispute")]: machine(
    "forum.form_valid",
    "同上：形式有效性是规则判断，不涉及商业取舍。",
  ),
  [wordRevisionKey("lease.dispute")]: machine(
    "forum.form_valid",
    "同上：形式有效性是规则判断，不涉及商业取舍。",
  ),
  [wordRevisionKey("em.dispute")]: machine(
    "forum.form_valid",
    "「是否排除劳动仲裁或缩短时效」属法定禁止性形式检查，由同组规则覆盖。",
  ),
  [wordRevisionKey("loan.guarantee")]: machine(
    "guarantee.form_valid",
    "「保证方式是否写明连带」由 `form.guarantee_form_default` 确定性给出——是形式要件，不是程度判断。",
  ),
  [wordRevisionKey("loan.period")]: machine(
    "guarantee.form_valid",
    "「保证期间是否约定」由 `form.guarantee_period` 给出，属存在性检查。",
  ),
  [wordRevisionKey("pr.deposit")]: machine(
    "statute.deposit_cap",
    "「定金比例」是否超 20% 由 `statutory.deposit_cap`（民法典第586条）给出，是法定上限比较。",
  ),
  [wordRevisionKey("loan.rate")]: machine(
    "statute.lpr_multiple",
    "「利率合计是否超过 LPR 四倍」由 `statutory.lpr_multiple` 覆盖，是法定上限比较。",
  ),
};

// ─────────────────────────────────────────────
// lawyer：17 项（商业取舍 / 价值权衡 / 办案策略——永不编译，只升级）
// ─────────────────────────────────────────────

const LAWYER_ENTRIES: JudgmentTable = {
  [wordRevisionKey("eq.price")]: lawyer(
    "对价与估值口径属商业谈判结果，须由您决定",
    "「期权池是否计入投前」「付款是否与交割挂钩」是谈判取舍，不同律师会给出不同答案。",
  ),
  [wordRevisionKey("eq.liq")]: lawyer(
    "优先清算倍数与参与/非参与属商业条款水平，须由您定夺",
    "清算优先的倍数与是否参与是价格的一部分，不存在唯一的「正确」数值。",
  ),
  [wordRevisionKey("eq.lockup")]: lawyer(
    "锁定期与离职回购作价属商业条款水平，须由您定夺",
    "锁定期长度与回购作价是创始人与投资人之间的价值分配，须由您拍板。",
  ),
  [wordRevisionKey("eq.veto")]: lawyer(
    "保护性条款侵入经营的程度须由您按交易地位判断",
    "「是否侵入日常经营」没有客观阈值，取决于交易地位与治理预期。",
  ),
  [wordRevisionKey("eq.exit")]: lawyer(
    "是否为小股东预设退出路径属交易结构决策，须由您定夺",
    "退出路径的设计是交易结构选择，涉及各方利益再分配。",
  ),
  [wordRevisionKey("eq.rofr")]: lawyer(
    "优先认购/共同出售/随售门槛属商业条款水平，须由您定夺",
    "各类优先权与随售门槛是利益平衡结果，无数值上的唯一正解。",
  ),
  [wordRevisionKey("pr.inspect")]: lawyer(
    "检验期限是否过短须结合交易实际由您判断",
    "「过短」没有客观标准，取决于行业惯例与标的特性。",
  ),
  [wordRevisionKey("pr.cap")]: lawyer(
    "责任上限的水平属商业风险分配，须由您定夺",
    "上限倍数与是否排除间接损失是风险分配的商业决策（法定不可免除的部分由规则另行把住）。",
  ),
  [wordRevisionKey("lease.deposit")]: lawyer(
    "押金数额属商业条款水平，须由您定夺",
    "押金金额取决于市场与议价地位，无客观上限。",
  ),
  [wordRevisionKey("tech.license")]: lawyer(
    "许可类型与地域期限范围属商业安排，须由您定夺",
    "独占/排他/普通的取舍取决于商业目标，不是可枚举的正确值。",
  ),
  [wordRevisionKey("tech.secret")]: lawyer(
    "技术秘密成果的收益分配属商业安排，须由您定夺",
    "使用、转让与收益分配是利益分配条款，须由您与客户商定。",
  ),
  [wordRevisionKey("em.post")]: lawyer(
    "单方调岗调薪的幅度属管理政策，须由您与客户商定",
    "调岗调薪的授权范围是单位管理政策取向，不同客户差异很大。",
  ),
  [wordRevisionKey("ma.gap")]: lawyer(
    "过渡期经营限制的宽严属交易安排，须由您定夺",
    "过渡期限制的强度是买卖双方的商业安排。",
  ),
  [verificationKey("contract-review-v1", "negotiate")]: lawyer(
    "谈判优先级与接受理由属办案策略，只有您能定",
    "「哪些可以让、哪些必须争」是办案策略，不是可从正文推出的结论。",
  ),
  [verificationKey("demand-letter-v1", "tone")]: lawyer(
    "语气与送达意图属办案策略，只有您能定",
    "催告函的语气取决于诉讼/和解策略与客户关系。",
  ),
  [verificationKey("compliance-dossier-v1", "actions")]: lawyer(
    "行动建议中客户/所内的分工属办案安排，须由您定",
    "哪些动作交客户、哪些留所内，取决于委托范围与客户能力。",
  ),
  [verificationKey("learning-brief-v1", "practice")]: lawyer(
    "实务启示与读者用途是否匹配属交付定位，须由您定",
    "简报的读者用途由您指定，不存在可从文本推出的正解。",
  ),
};

// ─────────────────────────────────────────────
// judge：112 项（需要语义判断，但判据可枚举）
// ─────────────────────────────────────────────

/**
 * 逐族批量登记 judge 项。族级 rationale 说明「为什么这一族需要语义阅读」，
 * 个别项若理由特殊，用 `overrides` 单独写。
 */
function judgeFamily(input: {
  ids: readonly string[];
  rationale: string;
  overrides?: Record<string, Entry>;
}): JudgmentTable {
  const out: Record<string, Entry> = {};
  for (const id of input.ids) {
    out[wordRevisionKey(id)] = input.overrides?.[id] ?? judge(input.rationale);
  }
  return out;
}

const JUDGE_ENTRIES: JudgmentTable = {
  ...judgeFamily({
    ids: [
      "eq.captable",
      "eq.transfer",
      "eq.board",
      "eq.vam",
      "eq.buyback",
      "eq.antidilute",
      "eq.reps",
      "eq.closing",
      "eq.info",
      "eq.ip",
      "eq.tax",
      "eq.charter",
      "eq.comply",
    ],
    rationale:
      "需要阅读条款实质并对照法律要件（如对赌义务主体、定向减资的全体股东同意路径），判据可枚举但无法由字符串确定性推出。",
    overrides: {
      "eq.vam": judge(
        "「义务主体是股东还是目标公司」是法定效力问题（公司法资本维持），有正解，须读条款实质。",
      ),
      "eq.buyback": judge(
        "「定向减资是否已获全体股东同意路径」是法定程序要件，有正解，须结合章程与决议文件判断。",
      ),
      "eq.charter": judge(
        "「权利是否已落到公司章程」需要跨文件比对股东协议与章程文本，属语义比对。",
      ),
    },
  }),
  ...judgeFamily({
    ids: [
      "ma.subject",
      "ma.process",
      "ma.price",
      "ma.dd",
      "ma.reps",
      "ma.debt",
      "ma.closing",
      "ma.noncompete",
      "ma.tax",
      "ma.approval",
    ],
    rationale:
      "需要对照公司法与登记实务判断（如未届期出资的转让责任分配、优先购买权处理路径），有正解但须读实质。",
    overrides: {
      "ma.noncompete": judge("竞业限制的期限与人群有法定边界，须对照条款实质与人员身份判断。"),
      "ma.tax": judge("「平价/低价转让的核定风险」须结合交易实质与税法规则判断。"),
    },
  }),
  ...judgeFamily({
    ids: [
      "pr.party",
      "pr.subject",
      "pr.price",
      "pr.pay",
      "pr.delivery",
      "pr.title",
      "pr.warranty",
      "pr.delay",
      "pr.ip",
      "pr.data",
      "pr.form",
      "pr.invoice",
      "pr.term",
      "pr.force",
      "pr.license",
    ],
    rationale:
      "需要阅读条款实质并对照法律要件（如所有权保留登记对抗、法定强制质保不得缩短、背靠背条款效力），判据可枚举但非确定性。",
    overrides: {
      "pr.pay": judge("「是否存在以第三方付款为前提的背靠背条款」需要识别条款实质，属语义判断。"),
      "pr.form": judge("「免责/责任限制是否已提示说明」涉及格式条款提示义务的实质判断。"),
    },
  }),
  ...judgeFamily({
    ids: [
      "constr.party",
      "constr.tender",
      "constr.price",
      "constr.priority",
      "constr.schedule",
      "constr.quality",
      "constr.sub",
      "constr.back2back",
      "constr.accept",
      "constr.wage",
    ],
    rationale:
      "需要对照建工司法解释与强制性规定判断效力（如无资质合同无效但工程合格可折价补偿），有正解但须读实质。",
  }),
  ...judgeFamily({
    ids: [
      "tech.scope",
      "tech.ip",
      "tech.warranty",
      "tech.open",
      "tech.data",
      "tech.accept",
      "tech.maint",
      "tech.invalid",
      "tech.export",
    ],
    rationale:
      "需要对照技术合同规范与出口管制判断（如专利申请权归属、传染性开源许可的合规影响），判据可枚举但非确定性。",
    overrides: {
      "tech.invalid": judge(
        "「是否限制技术改进、限制获取竞争技术」属非法垄断技术条款，效力判断须读实质。",
      ),
    },
  }),
  ...judgeFamily({
    ids: [
      "loan.party",
      "loan.principal",
      "loan.purpose",
      "loan.repay",
      "loan.secure",
      "loan.corporate",
      "loan.spouse",
      "loan.accel",
    ],
    rationale:
      "需要对照民间借贷司法解释与担保制度判断（如职业放贷认定、公司对外担保决议、流押流质禁止），有正解但须读实质。",
    overrides: {
      "loan.principal": judge(
        "「有无预扣利息（砍头息）」需结合交付金额与实际到账判断，属事实与法律的结合判断。",
      ),
      "loan.corporate": judge("「公司对外担保是否经决议」需核对决议文件与相对人善意，属要件判断。"),
    },
  }),
  ...judgeFamily({
    ids: [
      "lease.party",
      "lease.term",
      "lease.rent",
      "lease.use",
      "lease.repair",
      "lease.sublease",
      "lease.sale",
      "lease.improve",
      "lease.terminate",
      "lease.handover",
    ],
    rationale:
      "需要对照租赁与物权规范判断（如买卖不破租赁、优先购买权、住改商的合规后果），判据可枚举但非确定性。",
    overrides: {
      "lease.term": judge(
        "「是否超过二十年」有法定上限，但须结合续订与期限叠加判断，暂留 judge（`LEASE_TERM_MAX_YEARS` 参数已备，尚无规则）。",
      ),
      "lease.sale": judge("「买卖不破租赁与优先购买权」须结合通知与行使情况判断。"),
    },
  }),
  ...judgeFamily({
    ids: [
      "em.essential",
      "em.term",
      "em.probation",
      "em.hours",
      "em.pay",
      "em.social",
      "em.secret",
      "em.noncompete",
      "em.nccomp",
      "em.train",
      "em.penalty",
      "em.terminate",
      "em.rules",
      "em.ip",
      "em.dispatch",
      "em.criminal",
    ],
    rationale:
      "需要对照劳动合同法强制性规定判断（如试用期上限与次数、竞业补偿、违约金法定两种、民主程序），有正解但须读实质。",
    overrides: {
      "em.criminal": judge(
        "「扣证、限制人身、恶意欠薪」须识别实质措辞并对照刑法与劳动法，属语义判断。",
      ),
      "em.dispatch": judge("「是劳动还是劳务/外包」需要按实际用工管理程度作实质认定。"),
      "em.secret": judge("「保密范围是否等于竞业」需要比对两条款的范围是否等价，属语义比对。"),
    },
  }),
  ...judgeFamily({
    ids: [
      "charter.items",
      "charter.capital",
      "charter.legalrep",
      "charter.organs",
      "charter.vote",
      "charter.transfer",
      "charter.profit",
      "charter.meeting",
      "charter.duty",
      "charter.protect",
    ],
    rationale:
      "需要对照公司法与登记实务判断（如审计委员会替代监事会、认缴出资过渡期、知情权与压迫救济衔接），有正解但须读实质。",
    overrides: {
      "charter.items": judge(
        "「是否载明全部法定事项」是清单齐备性检查，但法定事项随公司法修订变化，暂留 judge。",
      ),
      "charter.capital": judge(
        "「认缴出资日期是否超过五年」涉及新旧法过渡期安排，须结合设立时间判断。",
      ),
    },
  }),
  // verification checklist 的非 machine / 非 lawyer 项
  [verificationKey("contract-review-v1", "liability")]: judge(
    "「已审阅责任限制/赔偿上限」是覆盖面声明，须核对是否真的逐条审过。",
  ),
  [verificationKey("contract-review-v1", "ip")]: judge(
    "「已审阅知识产权与保密条款」是覆盖面声明，须核对实质。",
  ),
  [verificationKey("contract-review-v1", "terminate")]: judge(
    "「已审阅解除/终止与违约后果」是覆盖面声明，须核对实质。",
  ),
  [verificationKey("contract-review-v1", "client")]: judge(
    "「可对外摘要不含未核实断言」须逐句核对对外表述与已核实范围。",
  ),
  [verificationKey("compliance-dossier-v1", "jurisdiction")]: judge(
    "「管辖区与效力层级已核对」须判断是否以新闻冒充现行法，属实质判断。",
  ),
  [verificationKey("compliance-dossier-v1", "verify")]: judge(
    "「不确定处已标 [VERIFY]」须判断哪些处属于不确定——标记的存在性是机械的，但该标未标不是。",
  ),
  [verificationKey("learning-brief-v1", "authority")]: judge(
    "「制度要点已按效力层级区分」须判断每则依据的位阶，属实质判断。",
  ),
  [verificationKey("training-ppt-v1", "desense")]: judge(
    "「已脱敏或确认不含未公开敏感信息」须判断材料是否含敏感信息，属实质判断。",
  ),
  [verificationKey("training-ppt-v1", "speakable")]: judge(
    "「幻灯片短句可讲，未整页粘贴长文」涉及可讲性的主观阈值，暂留 judge。",
  ),
  [verificationKey("general-v1", "scope")]: judge(
    "「交付范围与律师指令一致」须比对指令与产出的覆盖关系，属语义比对。",
  ),
  [verificationKey("general-v1", "risk")]: judge(
    "「已知风险已向律师可见」须判断哪些属已知风险，属实质判断。",
  ),
};

/**
 * 全量判定表：**150 项**，一处不漏。
 *
 * `item-judgments.test.ts` 会以硬数字断言条数——新增检查单项时测试会红，
 * 逼作者同时给出分级。这是把「分级不是可选项」变成机械约束的唯一办法。
 */
export const ITEM_JUDGMENTS: JudgmentTable = {
  ...MACHINE_ENTRIES,
  ...LAWYER_ENTRIES,
  ...JUDGE_ENTRIES,
};

/** 实测规模，供报告与断言引用（改了清单就要改这里）。 */
export const EXPECTED_TOTAL_ITEMS = 150;
export const EXPECTED_WORD_REVISION_ITEMS = 125;
export const EXPECTED_VERIFICATION_ITEMS = 25;
