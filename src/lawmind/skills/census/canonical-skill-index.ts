/**
 * Runtime index of the canonical external legal-skill design corpus.
 * Metadata only — no third-party SKILL bodies. Used by read_skill catalog.
 * Source of truth for narrative: docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md
 */

export type CanonicalSkillAbsorb = "absorb" | "structure_only" | "skip";

export type CanonicalSkillIndexEntry = {
  id: string;
  label: string;
  sourceRepo: string;
  licenseAbsorb: CanonicalSkillAbsorb;
  /** Optional LawMind capability id this maps to (design hint only). */
  mapsToCapabilityId?: string;
  when: string;
  notWhen: string;
};

/** ~curated units from the canonical doc — not thousands of thin SKILL.md files. */
export const CANONICAL_SKILL_INDEX: readonly CanonicalSkillIndexEntry[] = [
  {
    id: "anthropic-commercial-legal-os",
    label: "商业合同插件 OS",
    sourceRepo: "anthropics/claude-for-legal",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "contract.review",
    when: "需要工作台冷启动、playbook、升级矩阵的架构参考",
    notWhen: "不要把对方逐条 SKILL 正文装进发行包",
  },
  {
    id: "anthropic-review-router",
    label: "/review 路由器",
    sourceRepo: "anthropics/claude-for-legal",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "contract.review",
    when: "按合同类型路由审查 playbook",
    notWhen: "不要向律师弹出办件菜单代替隐式编译",
  },
  {
    id: "panrui-legal-workbench",
    label: "法律工作总控",
    sourceRepo: "pa1nrui1/legal-skills",
    licenseAbsorb: "absorb",
    when: "中国律师工作台：事项隔离、法规核验、出稿闭环",
    notWhen: "不要用聊天摘要冒充工作台期限/谈话真相源",
  },
  {
    id: "panrui-contract-redline",
    label: "合同审查 + redline-plan + QA",
    sourceRepo: "pa1nrui1/legal-skills",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "contract.review",
    when: "计划 → 原生修订 → w:ins/w:del QA",
    notWhen: "无修订轨不得对律师显示已完成",
  },
  {
    id: "greater-china-contract-os",
    label: "合同审查场景 OS",
    sourceRepo: "vivy-yi/Greater-China-Legal",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "contract.review",
    when: "角色档位、可签/需改/不可签决策树",
    notWhen: "不要 vendoring 全部 574 个原子 Skill",
  },
  {
    id: "horizon-dispute-cluster",
    label: "宏志争议解决簇",
    sourceRepo: "FAYANHUIYING/claude-for-legal-HoriZon",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "litigation.draft",
    when: "中国诉讼：接案、要件、起诉状、期限",
    notWhen: "不要重复 cold-start-interview 三问主路径",
  },
  {
    id: "lpm-skills",
    label: "法律项目管理",
    sourceRepo: "legalopsconsulting/lpm-skills",
    licenseAbsorb: "absorb",
    when: "接案、范围、预算、期限、状态报告",
    notWhen: "不要做成 AmLaw 操作系统替代品",
  },
  {
    id: "contract-copilot-layers",
    label: "分层四步 + 原生修订",
    sourceRepo: "cat-xierluo/legal-skills",
    licenseAbsorb: "structure_only",
    mapsToCapabilityId: "contract.review",
    when: "借鉴宏观–中观–微观与阻塞项结构",
    notWhen: "CC-BY-NC：只借鉴结构，独立实现",
  },
  {
    id: "legal-research-cn",
    label: "中国法源检索",
    sourceRepo: "Golden2002/legal-research-skill",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "research.memo",
    when: "效力层级、特别规定、报告形态分流",
    notWhen: "样本库命中不得写成已核实法条",
  },
  {
    id: "yuandian-search-middleware",
    label: "元典检索中间层",
    sourceRepo: "cat-xierluo/legal-skills",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "research.memo",
    when: "先命题与查询矩阵，再调 MCP",
    notWhen: "无命中时诚实拒答，不编造批次号",
  },
  {
    id: "pkulaw-docx-workflow",
    label: "北大法宝 / DOCX 工作流",
    sourceRepo: "NEU-ZHA/legal-ai-skills",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "research.memo",
    when: "商业权威库 + 引用 + 文书",
    notWhen: "未配置法宝时不得声称已接真源",
  },
  {
    id: "civil-litigation-pipeline",
    label: "民事一审全流程",
    sourceRepo: "pa1nrui1/legal-skills",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "litigation.draft",
    when: "程序阶段路由（立案/证据/庭审…）",
    notWhen: "不要把所有诉讼写成一个 prompt",
  },
  {
    id: "period-manager",
    label: "诉讼期限管理",
    sourceRepo: "SimbaCD/legal-period-manager-skills",
    licenseAbsorb: "absorb",
    when: "期限计算与提醒",
    notWhen: "聊天摘要不能替代 deadlines.jsonl",
  },
  {
    id: "second-review-agent",
    label: "法律文书第二轮复核",
    sourceRepo: "lowtidebuild/second-review-agent",
    licenseAbsorb: "absorb",
    when: "独立审稿视角（对齐 Guardian）",
    notWhen: "写者不得给自己打分冒充验收",
  },
  {
    id: "merger-acquisition-cn",
    label: "中国并购全流程",
    sourceRepo: "12754271-maker/merger-acquisition-skill",
    licenseAbsorb: "absorb",
    mapsToCapabilityId: "due_diligence",
    when: "尽调到交割整合",
    notWhen: "未读材料不得出可签结论",
  },
];

export function formatCanonicalSkillIndexCatalog(limit = 40): string[] {
  return CANONICAL_SKILL_INDEX.slice(0, limit).map(
    (e) => `${e.id}（规范库·${e.licenseAbsorb}·${e.sourceRepo}）— ${e.label}；不执行、不装包`,
  );
}

export function lookupCanonicalSkillIndex(skillId: string): CanonicalSkillIndexEntry | undefined {
  const q = skillId.trim().toLowerCase();
  if (!q) {
    return undefined;
  }
  return CANONICAL_SKILL_INDEX.find(
    (e) =>
      e.id === q ||
      e.id.toLowerCase() === q ||
      e.label === skillId.trim() ||
      e.label.toLowerCase() === q,
  );
}
