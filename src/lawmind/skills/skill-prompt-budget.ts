/**
 * Lean skill injection: inject the structural target, index the rest.
 *
 * ## 为什么不再是「固定挑 2 篇」
 *
 * 旧实现用 `PRIMARY_BY_CAPABILITY` 人工指定每类办件注入哪 2 篇正文，其余只留索引。
 * 实测问题是这个「2」把正文顶过了帽：`contract.review` 两篇正文 2,395 token
 * （`estimateTextTokens` 对中文按 1 字符 ≈ 1 token），而 `skill_index` 的帽是 2,000，
 * `capFragmentBody` 于是把 Playbook 后半截切掉。半篇规则比没有规则更糟。
 *
 * ## 现在的规则
 *
 * 注入目标是**本阶段技能**（阶段表 / 诉讼阶段路由），不是「能塞多少塞多少」，
 * 也不是「每篇相关的都塞进去」。
 *
 * 曾试过把 `citation-grounding` / `norm-validity` / `legal-element-extraction`
 * 当成跨能力不变量整篇注入。收回了：系统提示已经要求引用有据；检索协议已经指向
 * 「规范现行有效」并说明钉选路径不要翻案卷；要素提取是叙事交办的工序，钉着合同
 * 做条款审查时整篇灌进去，是在用检查表挤掉模型对这份合同的判断。需要时模型用
 * `read_skill` 自己取，索引行里有一句话说明。
 *
 * 帽只作**不切半篇**的保证：本次 `capTokens = max(skill_index 基准帽, 实测量)`，
 * 编排侧把它传给 `queue`，`capFragmentBody` 就不再按字符腰斩。基准帽仍是
 * `prompt-fragments.ts` 那一项，本模块不新立数字。
 *
 * `STAGE_FIRST_BY_CAPABILITY` 就是注入目标。阶段表里已经点名的引用、效力、要素
 * 仍然注入（那是这一阶段的工序）；没点名的留在索引里。
 */

import { estimateTextTokens } from "../agent/context-budget.js";
import { scaleFragmentCapTokens } from "../agent/prompt-fragments.js";
import type { BoundLawyerCapability } from "./lawyer-capabilities.js";
import {
  formatBoundCapabilityBlock,
  readBuiltinSkillMarkdown,
  readSkillPromptBodies,
} from "./lawyer-capabilities.js";
import { litigationPrimary } from "./litigation-primary.js";

/** 本阶段要注入正文的技能。没列在这里的，即使能力声明了，也只留索引。 */
const STAGE_FIRST_BY_CAPABILITY: Record<string, readonly string[]> = {
  "contract.review": ["contract-review-layers", "contract-playbook-review"],
  "contract.draft": ["contract-drafting-route", "practice-defaults"],
  "mail.contract": ["contract-review-layers", "citation-grounding"],
  "letter.draft": ["delivery-language", "legal-element-extraction"],
  "research.memo": ["research-query-matrix", "citation-grounding"],
  "materials.draft": ["delivery-language", "legal-element-extraction"],
  "analysis.quick": ["quick-legal-triage", "legal-element-extraction"],
  "labor.calc": ["labor-compensation-calc"],
  "period.calc": ["legal-period-calc"],
  "chronology.timeline": ["chronology-two-stage", "chronology-from-materials"],
  "matter.intake": ["matter-from-materials", "matter-budget-lite"],
  "ops.invoice": ["invoice-organizer"],
  "ops.court_sms": ["court-sms-intake", "legal-event-extract"],
  "litigation.talk": ["client-talk-intake", "legal-element-extraction"],
  "ip.dispute": ["ip-dispute-route", "evidence-argument-chain"],
  "deal.ma": ["ma-diligence-route", "legal-element-extraction"],
  "compliance.data": ["data-compliance-route", "norm-validity"],
  "compliance.ads": ["ads-compliance-route", "norm-validity"],
  "matter.status": ["matter-status-report", "matter-status-scope-budget"],
  "family.matter": ["family-matter-route", "legal-element-extraction"],
  "capital.markets": ["capital-markets-route", "citation-grounding"],
  "corp.governance": ["governance-route", "norm-validity"],
};

function stageHeadFor(bound: BoundLawyerCapability, instruction: string): readonly string[] {
  if (bound.id === "mail.contract") {
    return ["contract-review-layers", "citation-grounding"];
  }
  if (bound.pipeline === "tracked_redline" && bound.id === "contract.review") {
    return ["contract-review-layers", "contract-redline-craft"];
  }
  if (bound.pipeline === "tracked_redline" && bound.id === "litigation.draft") {
    // 原语义是「能力声明的前两篇」；扩成全部 13 篇会把刑辩/家事/破产的阶段路由
    // 一起灌进同一轮改稿。
    return bound.skillIds.slice(0, 2);
  }
  if (bound.id === "litigation.draft") {
    return litigationPrimary(instruction, bound.deliverableType);
  }
  return STAGE_FIRST_BY_CAPABILITY[bound.id] ?? [];
}

function dedupeWithin(allowed: ReadonlySet<string>, ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!allowed.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 要注入正文的技能：本阶段技能，按阶段表顺序去重。
 * 不在能力声明里的 id 丢掉（阶段表是提示，能力声明才是边界）。
 */
export function structuralTargetIdsFor(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  return dedupeWithin(new Set(bound.skillIds), stageHeadFor(bound, instruction));
}

/** 全部候选的优先顺序：结构目标在前，余下按能力声明顺序。 */
export function orderedSkillIdsForBound(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  const target = structuralTargetIdsFor(bound, instruction);
  const targetSet = new Set(target);
  const allowed = new Set(bound.skillIds);
  const rest = bound.skillIds.filter((id) => !targetSet.has(id));
  return [...target, ...dedupeWithin(allowed, rest)];
}

/** 旧的导出名：语义已从「入选的 2 篇」变为「注入优先顺序」，保留以免调用方断链。 */
export function primarySkillIdsForBound(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  return structuralTargetIdsFor(bound, instruction);
}

export function skillIndexLine(skillId: string): string {
  const md = readBuiltinSkillMarkdown(skillId);
  if (!md) {
    return skillId;
  }
  const name = /^name:\s*(.+)$/m.exec(md)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(md)?.[1]?.trim();
  const label = description || name || skillId;
  return `${skillId}：${label}`;
}

export type LeanSkillPrompt = {
  /** 注入正文的技能，按注入顺序。 */
  primaryIds: string[];
  /** 只留索引的技能。 */
  indexIds: string[];
  indexLines: string[];
  /** 估算出的实际入队 token 数（与 `skill_index` 帽同一口径）。 */
  estimatedTokens: number;
  /**
   * 本次应传给 `queue` 的帽。恒 ≥ 基准帽，且 ≥ 实测量——**保证不被按字符腰斩**。
   */
  capTokens: number;
};

export type PlanLeanSkillPromptOptions = {
  /** 覆盖基准帽（默认取 `skill_index` 的帽）。测试用。 */
  capTokens?: number;
  /**
   * 把「当前这批 primaryIds + 这些索引行」渲染成**最终要入队的字符串**。
   *
   * 预算必须量真实产物，不能量近似值：编排侧还会注入 `compiled`（组合与律师摘要）
   * 等文字，若这里少算，`capFragmentBody` 就会按字符腰斩最后一份正文。
   * 编排侧传入自己的渲染函数即可完全对齐；不传则用不带 compiled 的标准渲染。
   */
  render?: (primaryIds: readonly string[], indexLines: readonly string[]) => string;
};

function defaultRender(
  bound: BoundLawyerCapability,
  instruction: string,
): (primaryIds: readonly string[], indexLines: readonly string[]) => string {
  return (primaryIds, indexLines) =>
    formatBoundCapabilityBlock(bound, readSkillPromptBodies(undefined, [...primaryIds]), {
      indexLines: [...indexLines],
      instruction,
    });
}

/**
 * 注入结构目标全部正文，其余进索引。
 *
 * 不做「能塞多少塞多少」：那样会把同能力的其它阶段路由（刑辩、家事、破产…）灌进
 * 一个不相干的回合。目标定下来之后，篇幅只用来决定**帽**，不用来决定**取舍**。
 */
export function planLeanSkillPrompt(
  bound: BoundLawyerCapability,
  instruction: string,
  opts: PlanLeanSkillPromptOptions = {},
): LeanSkillPrompt {
  const baseCap = opts.capTokens ?? scaleFragmentCapTokens("skill_index");
  const render = opts.render ?? defaultRender(bound, instruction);
  const ordered = orderedSkillIdsForBound(bound, instruction);
  const target = structuralTargetIdsFor(bound, instruction);
  const primaryIds = target.length > 0 ? target : ordered.slice(0, 1);
  const primarySet = new Set(primaryIds);
  const indexIds = ordered.filter((id) => !primarySet.has(id));
  const indexLines = indexIds.map(skillIndexLine);
  const block = render(primaryIds, indexLines);
  const estimatedTokens = estimateTextTokens(block);
  return {
    primaryIds,
    indexIds,
    indexLines,
    estimatedTokens,
    capTokens: Math.max(baseCap, estimatedTokens),
  };
}
