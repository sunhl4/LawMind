/**
 * Leaf: 办件流程锁。律师从列表选流程，不必记住激活词。
 * Safe for desktop renderer (no fs).
 */

export const LAWYER_CAPABILITY_IDS = [
  "contract.review",
  "letter.draft",
  "research.memo",
  "litigation.draft",
  "litigation.talk",
  "materials.draft",
  "mail.contract",
  "analysis.quick",
  "contract.draft",
  "labor.calc",
  "chronology.timeline",
  "matter.intake",
  "period.calc",
  "ops.invoice",
  "ops.court_sms",
  "ip.dispute",
  "deal.ma",
  "compliance.data",
  "compliance.ads",
  "matter.status",
  "family.matter",
  "capital.markets",
  "corp.governance",
] as const;

export type LawyerCapabilityId = (typeof LAWYER_CAPABILITY_IDS)[number];

export type LawyerCapabilityDeskAction =
  | "lock"
  | "contract-lane"
  | "research-lane"
  | "mail-lane"
  | "write-materials";

export type LawyerCapabilityDeskItem = {
  id: LawyerCapabilityId;
  label: string;
  hint: string;
  testId: string;
  action: LawyerCapabilityDeskAction;
  defaultDeliverableType?: string;
};

/** Compose「办件」流程列表（律师词，不是激活口令）。 */
export const LAWYER_CAPABILITY_DESK_ITEMS: readonly LawyerCapabilityDeskItem[] = [
  {
    id: "contract.review",
    label: "合同审查",
    hint: "按已附合同走审查流水线",
    testId: "lm-desk-work-contract",
    action: "contract-lane",
    defaultDeliverableType: "contract.review",
  },
  {
    id: "letter.draft",
    label: "函件起草",
    hint: "按已附事实起草函件",
    testId: "lm-empty-verb-draft",
    action: "lock",
    defaultDeliverableType: "letter.counsel",
  },
  {
    id: "research.memo",
    label: "检索研究",
    hint: "按已附问题检索并出备忘",
    testId: "lm-empty-open-research-fast-lane",
    action: "research-lane",
    defaultDeliverableType: "memo.research",
  },
  {
    id: "litigation.draft",
    label: "诉讼文书",
    hint: "按已附案情起草诉讼材料",
    testId: "lm-desk-work-litigation",
    action: "lock",
    defaultDeliverableType: "litigation.outline",
  },
  {
    id: "litigation.talk",
    label: "谈话整理",
    hint: "谈话记录整理成需求、案由和证据缺口",
    testId: "lm-desk-work-talk",
    action: "lock",
    defaultDeliverableType: "memo.internal",
  },
  {
    id: "materials.draft",
    label: "写材料",
    hint: "意见书 / 备忘等，可填表锁结构",
    testId: "lm-compose-write-materials",
    action: "write-materials",
    defaultDeliverableType: "document.general",
  },
  {
    id: "mail.contract",
    label: "邮件合同审阅",
    hint: "邮箱来件走同一套审查门禁",
    testId: "lm-empty-open-mail-fast-lane",
    action: "mail-lane",
    defaultDeliverableType: "contract.review",
  },
  {
    id: "analysis.quick",
    label: "法律快问",
    hint: "一句话问题直接给结论和依据",
    testId: "lm-desk-work-analysis",
    action: "lock",
    defaultDeliverableType: "memo.internal",
  },
  {
    id: "contract.draft",
    label: "合同起草",
    hint: "按交易类型出条款骨架和完整稿",
    testId: "lm-desk-work-contract-draft",
    action: "lock",
    defaultDeliverableType: "contract.general",
  },
  {
    id: "labor.calc",
    label: "劳动计算",
    hint: "经济补偿、加班、双倍工资按公式算",
    testId: "lm-desk-work-labor",
    action: "lock",
    defaultDeliverableType: "labor.calc",
  },
  {
    id: "chronology.timeline",
    label: "时间轴",
    hint: "从材料抽出日期事件并去重",
    testId: "lm-desk-work-timeline",
    action: "lock",
    defaultDeliverableType: "matter.timeline",
  },
  {
    id: "matter.intake",
    label: "整理案卷",
    hint: "把已附材料归位并抽出当事人案由",
    testId: "lm-desk-work-matter-intake",
    action: "lock",
    defaultDeliverableType: "document.general",
  },
  {
    id: "period.calc",
    label: "期限计算",
    hint: "上诉、答辩、仲裁、执行期间按规则算届满日",
    testId: "lm-desk-work-period",
    action: "lock",
    defaultDeliverableType: "period.calc",
  },
  {
    id: "ops.invoice",
    label: "整理发票",
    hint: "发票归类、合计入卷",
    testId: "lm-desk-work-invoice",
    action: "lock",
    defaultDeliverableType: "document.general",
  },
  {
    id: "ops.court_sms",
    label: "法院短信",
    hint: "抽出案号、开庭时间和待办",
    testId: "lm-desk-work-court-sms",
    action: "lock",
    defaultDeliverableType: "matter.timeline",
  },
  {
    id: "ip.dispute",
    label: "知产争议",
    hint: "权利基础、被控侵权和程序路径",
    testId: "lm-desk-work-ip",
    action: "lock",
    defaultDeliverableType: "litigation.outline",
  },
  {
    id: "deal.ma",
    label: "并购尽调",
    hint: "股权/资产尽调提纲和交割清单",
    testId: "lm-desk-work-ma",
    action: "lock",
    defaultDeliverableType: "report.general",
  },
  {
    id: "compliance.data",
    label: "数据合规",
    hint: "个保法/数安法栏目，缺的标待核实",
    testId: "lm-desk-work-data-compliance",
    action: "lock",
    defaultDeliverableType: "report.compliance",
  },
  {
    id: "compliance.ads",
    label: "广告产品合规",
    hint: "广告用语和标签核对，给出可替换措辞",
    testId: "lm-desk-work-ads",
    action: "lock",
    defaultDeliverableType: "report.general",
  },
  {
    id: "matter.status",
    label: "办案周报",
    hint: "阶段、期限、范围；本地顾问和人力也走这里",
    testId: "lm-desk-work-matter-status",
    action: "lock",
    defaultDeliverableType: "memo.internal",
  },
  {
    id: "family.matter",
    label: "家事继承",
    hint: "离婚、抚养、继承按家事程序写",
    testId: "lm-desk-work-family",
    action: "lock",
    defaultDeliverableType: "litigation.outline",
  },
  {
    id: "capital.markets",
    label: "资本市场",
    hint: "发行和信息披露核对，不编未披露数字",
    testId: "lm-desk-work-capital",
    action: "lock",
    defaultDeliverableType: "report.general",
  },
  {
    id: "corp.governance",
    label: "公司治理",
    hint: "决议和治理备忘，不走章程 Word 改稿",
    testId: "lm-desk-work-governance",
    action: "lock",
    defaultDeliverableType: "memo.internal",
  },
];

const CAPABILITY_ID_SET = new Set<string>(LAWYER_CAPABILITY_IDS);

export function isLawyerCapabilityId(value: string): value is LawyerCapabilityId {
  return CAPABILITY_ID_SET.has(value);
}

const LOCK_RE = /【办件】\s*能力\s*[：:]\s*([a-z]+(?:\.[a-z]+)+)/i;

export function parseCapabilityLock(instruction: string): LawyerCapabilityId | undefined {
  const m = LOCK_RE.exec(instruction);
  const id = m?.[1]?.trim().toLowerCase();
  if (!id || !isLawyerCapabilityId(id)) {
    return undefined;
  }
  return id;
}

export function formatCapabilityDispatchPrompt(params: {
  id: LawyerCapabilityId;
  label: string;
  note?: string;
}): string {
  const note = params.note?.trim();
  return [
    `【办件】能力：${params.id}`,
    `流程：${params.label}`,
    "请按已附材料与钉源执行该流程。不必再猜测任务类型。",
    note ? `\n律师说明：\n${note}` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function deskItemById(id: LawyerCapabilityId): LawyerCapabilityDeskItem | undefined {
  return LAWYER_CAPABILITY_DESK_ITEMS.find((item) => item.id === id);
}
