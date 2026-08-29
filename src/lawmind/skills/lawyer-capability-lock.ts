/**
 * Leaf: 办件流程锁。律师从列表选流程，不必记住激活词。
 * Safe for desktop renderer (no fs).
 */

export const LAWYER_CAPABILITY_IDS = [
  "contract.review",
  "letter.draft",
  "research.memo",
  "litigation.draft",
  "materials.draft",
  "mail.contract",
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
    defaultDeliverableType: "memo.internal",
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
