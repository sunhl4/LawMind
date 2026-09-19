/**
 * 谈话档案 → 卷宗写穿。
 *
 * 为什么需要：`apply_intake_brief` 原本只打 `confirmedAt`，谈话里读到的案由、
 * 当事人留在 `intake-brief.json` 里，而工作台卷宗看的是 `matter.json`——律师在
 * 工作台看不到自己刚刚说过的事实。Claude Code 的同类故障（issue #55750：
 * 「已落盘但模型/界面看不到」）说明这类"写了等于没写"最伤信任。
 *
 * 原则（与 docs/LAWMIND-CHAT-MATTER-FILL.md §5「没有的字段不写」一致）：
 *   - 只提升**抽取器真正读到**的值，绝不编造。
 *   - 只提升卷宗里**还没有**的字段，不覆盖律师手输的内容。
 *   - 立场不明时（原告/被告谁是委托人）只登记当事人与其诉讼地位，不猜我方立场。
 */

import type { IntakeBrief } from "./intake-brief.js";
import { MATTER_PARTY_ROLES, type MatterParty, type MatterPartyRole } from "./matter-parties.js";

export type IntakePartyCandidate = {
  name: string;
  /** 文书里的原始标签，如「原告」「被告」「委托人」。 */
  label: string;
};

/** 能唯一确定我方/对方立场的标签；其余标签只登记不定位。 */
const CLIENT_LABELS = new Set(["委托人", "我方", "客户"]);
const COUNTERPARTY_LABELS = new Set(["对方", "相对方"]);

const PARTY_LABEL_RE =
  /(原告|被告|上诉人|被上诉人|申请人|被申请人|委托人|对方|相对方|甲方|乙方|用人单位|劳动者)[：:]\s*([^\n，。；;、,]{2,40})/g;

/**
 * 从谈论文本抽取当事人候选（标签 + 名称）。
 * 只用于「不丢信息」：把读到的当事人挂到卷宗上，立场判断交给律师或模型。
 */
/**
 * 去掉姓名后的括号注释：「张三（已另案）」「某公司（以下简称甲方）」都不该
 * 进当事人卡片当名字。只剥尾部括号，不动正文。
 */
function stripTrailingParenthetical(name: string): string {
  return name.replace(/[（(][^）)]*[）)]\s*$/, "").trim();
}

export function extractPartyCandidates(text: string): IntakePartyCandidate[] {
  const out: IntakePartyCandidate[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(PARTY_LABEL_RE)) {
    const label = (match[1] ?? "").trim();
    const name = stripTrailingParenthetical((match[2] ?? "").trim());
    if (!label || !name) {
      continue;
    }
    const key = `${label}|${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ name, label });
    if (out.length >= 16) {
      break;
    }
  }
  return out;
}

function roleForLabel(label: string): MatterPartyRole {
  if (CLIENT_LABELS.has(label)) {
    return "client";
  }
  if (COUNTERPARTY_LABELS.has(label)) {
    return "counterparty";
  }
  return "other";
}

export type PromoteIntakeResult = {
  /** 本次真正写进卷宗的字段名（用于回报律师写了什么）。 */
  promoted: string[];
  /** 立场未定、只登记不定位的当事人标签。 */
  standingOnly: string[];
};

/**
 * 算出该提升的卷宗变更（纯函数，便于测试；不触碰磁盘）。
 * @param current 卷宗现值（当事人、案由）
 * @param brief 已确认的谈话档案
 */
export function planIntakePromotion(input: {
  current: {
    parties?: MatterParty[];
    causeOfAction?: string;
  };
  brief: IntakeBrief;
  partyCandidates?: IntakePartyCandidate[];
}): {
  promoted: string[];
  standingOnly: string[];
  parties?: MatterParty[];
  causeOfAction?: string;
} {
  const promoted: string[] = [];
  const standingOnly: string[] = [];
  const existing = input.current.parties ?? [];
  const nextParties: MatterParty[] = [...existing];
  const takenNames = new Set(existing.map((p) => p.name));

  for (const candidate of input.partyCandidates ?? []) {
    if (takenNames.has(candidate.name)) {
      continue;
    }
    const role = roleForLabel(candidate.label);
    // 标签已是「委托人/对方」时才定位立场；原告/被告等只登记地位。
    const standing = role === "other" ? candidate.label : undefined;
    if (role === "other") {
      standingOnly.push(`${candidate.label}：${candidate.name}`);
    }
    nextParties.push({
      partyId: "",
      name: candidate.name,
      role,
      ...(standing ? { standing } : {}),
    });
    takenNames.add(candidate.name);
  }

  const partiesChanged = nextParties.length > existing.length;
  if (partiesChanged) {
    promoted.push("当事人");
  }

  const topCause = input.brief.causeCandidates?.[0]?.label?.trim() ?? "";
  const causeOfAction = !input.current.causeOfAction?.trim() && topCause ? topCause : undefined;
  if (causeOfAction) {
    promoted.push("案由");
  }

  return {
    promoted,
    standingOnly,
    ...(partiesChanged ? { parties: nextParties } : {}),
    ...(causeOfAction ? { causeOfAction } : {}),
  };
}

export function isKnownPartyRole(value: string): value is MatterPartyRole {
  return (MATTER_PARTY_ROLES as readonly string[]).includes(value);
}
