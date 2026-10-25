/**
 * Lean skill injection: inject the structural target, index the rest.
 *
 * ## 为什么不再是「固定挑 2 篇」
 *
 * 旧实现用 `PRIMARY_BY_CAPABILITY` 人工指定每类办件注入哪 2 篇正文，其余只留索引。
 * 两个实测问题：
 * 1. **漏掉跨交付物的质量不变量**：`contract.review` 的 8 篇里只注入「分层审查」和
 *    「Playbook」，`citation-grounding` / `norm-validity` / `legal-element-extraction`
 *    全部只留在索引里。这几篇管的是「引用要能指回来源」「先核现行有效」「先把生活叙事
 *    还原成要件事实」——对任何一份法律交付物都成立，不该靠模型自己去索引里捞。
 * 2. **2 这个数把正文顶过了帽，导致按字符腰斩**：实测 `contract.review` 两篇正文
 *    2,395 token（`estimateTextTokens` 对中文按 1 字符 ≈ 1 token），而 `skill_index`
 *    的帽是 2,000 —— `capFragmentBody` 于是把 Playbook 后半截切掉并留一个截断指针。
 *    这违反本仓「整块取舍」的既有做法（`material-blocks.ts`）。
 *
 * ## 现在的规则
 *
 * 注入目标**由数据决定，不由数字决定**：
 *
 *   structural target = 本阶段技能（阶段表 / 诉讼阶段路由）+ 质量不变量
 *
 * 其余整篇降级为一行索引（可 `read_skill` 按需取，或只取某一节）。目标是「哪几篇」，
 * 不是「能塞几篇」——后者会把 `litigation.draft` 里刑辩、家事、破产的阶段路由一起灌进
 * 一个民事起诉状回合，噪声比收益大。
 *
 * 帽只作**不切半篇**的保证：本次 `capTokens = max(skill_index 基准帽, 实测量)`，
 * 编排侧把它传给 `queue`，`capFragmentBody` 就不再按字符腰斩。基准帽仍是
 * `prompt-fragments.ts` 那一项，本模块不新立数字。
 *
 * `STAGE_FIRST_BY_CAPABILITY` 保留，但只决定**注入顺序**，不再决定取舍范围。
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

/**
 * 跨交付物的质量不变量：只要该能力自己列了这几篇，就注入正文。
 *
 * 它们不是某个阶段的工序，而是「任何一份交付物都得守」的底线；顺序只决定注入先后
 * （越靠前越是「本阶段直接相关」的补充），不决定取舍——目标集合是全部注入。
 *
 * `delivery-language` **不在**此列：它讲的是「草稿不得写成已签发」，属全局交付纪律，
 * 已在系统提示词与 `craft` 片段里；再整篇注入等于同一件事说三遍。
 */
export const INVARIANT_SKILL_IDS: readonly string[] = [
  "citation-grounding",
  "norm-validity",
  "legal-element-extraction",
];

/** 排序用：哪一阶段的正文排在最前（只影响注入先后，不影响取舍）。 */
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
 * 要注入正文的技能（结构目标）：本阶段技能 + 质量不变量，按注入顺序去重。
 *
 * 阶段表与不变量表在多处重叠（`letter.draft`、`deal.ma`…），去重是必需的：
 * 重复 id 会让同一篇被算两次预算，也会让索引里出现重名行。
 */
export function structuralTargetIdsFor(
  bound: BoundLawyerCapability,
  instruction: string,
): string[] {
  const allowed = new Set(bound.skillIds);
  return dedupeWithin(allowed, [...stageHeadFor(bound, instruction), ...INVARIANT_SKILL_IDS]);
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
