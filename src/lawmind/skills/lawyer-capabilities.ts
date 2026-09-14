/**
 * High-frequency lawyer work, productized as LawMind capabilities.
 * Each capability = Skill(s) + pipeline + acceptance — not free-form chat.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_REDLINE_CRAFT_SKILL } from "../drafts/contract-redline-craft.js";
import { compileIntent } from "../intent/compile-intent.js";
import type { CompiledIntent, CompileIntentInput } from "../intent/types.js";
import { isContractFastLaneInstruction } from "../platform/contract-fast-lane-instruction.js";
import type { DeliverableType } from "../types.js";
import { deskItemById, type LawyerCapabilityId } from "./lawyer-capability-lock.js";
import { listLocalSkills } from "./skill-runtime.js";

export type { LawyerCapabilityId } from "./lawyer-capability-lock.js";

export type LawyerCapabilityPipeline =
  | "execute_workflow"
  | "research_then_draft"
  | "tracked_redline";

export type LawyerCapability = {
  id: LawyerCapabilityId;
  label: string;
  skillIds: readonly string[];
  pipeline: LawyerCapabilityPipeline;
  pipelineHint: string;
};

export type BoundLawyerCapability = LawyerCapability & {
  deliverableType?: DeliverableType;
};

export type BindLawyerCapabilityInput = CompileIntentInput & {
  deliverableType?: DeliverableType;
};

const WORD_REVISION_SKILL_IDS = ["contract-redline-craft"] as const;

export const LAWYER_CAPABILITIES: readonly LawyerCapability[] = [
  {
    id: "contract.review",
    label: "合同审查",
    skillIds: [
      "contract-redline-craft",
      "contract-review-layers",
      "practice-defaults",
      "legal-element-extraction",
      "norm-validity",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "未锁时优先 `execute_workflow` / `draft_document`；锁路径按本轮工具表。意见须含宏观/中观/微观与推荐措辞。有钉选 Word 且本回合开放改稿工具时完成=意见+`apply_surgical_edits`→`render_tracked_draft`。原 Word / 邮件红线不走本意见骨架。空修订不得导出。写条号前若本回合开放 `search_statute` 则先试检 1–2 条。",
  },
  {
    id: "letter.draft",
    label: "函件起草",
    skillIds: [
      "intake-required-inputs",
      "practice-defaults",
      "legal-element-extraction",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "未锁时优先 `execute_workflow` / `draft_document`；锁路径按本轮工具表。缺收件人且无材料时才硬澄清；否则边写边标【待补充】。",
  },
  {
    id: "research.memo",
    label: "检索研究",
    skillIds: [
      "research-query-matrix",
      "norm-validity",
      "legal-element-extraction",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "research_then_draft",
    pipelineHint:
      "先命题矩阵再 `research_task` / `search_statute` / `search_case_law`；每个争点正反各查，先试检 1–2 条再扩。正式备忘须含现行法条与正反类案栏，不得凭记忆编造法条原文。无命中仍保留栏目并标【待核实】。正式备忘走 `execute_workflow`。",
  },
  {
    id: "litigation.draft",
    label: "诉讼文书",
    skillIds: [
      "intake-required-inputs",
      "litigation-stage-route",
      "evidence-argument-chain",
      "legal-element-extraction",
      "complaint-elements-fill",
      "legal-period-calc",
      "criminal-stage-route",
      "bankruptcy-stage-route",
      "ip-dispute-route",
      "family-matter-route",
      "practice-defaults",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "未锁时优先 `execute_workflow`；锁路径按本轮工具表。主体/诉请缺口标【待补充】或硬澄清，不得空跑外发。起诉状走要素母版（线性栏目，不要 markdown 表）。期限用 `calculate`（legal_period）。",
  },
  {
    id: "litigation.talk",
    label: "谈话整理",
    skillIds: [
      "client-talk-intake",
      "legal-element-extraction",
      "evidence-argument-chain",
      "intake-required-inputs",
      "practice-defaults",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "把谈话编成需求、核心事实、候选案由和证据缺口。律师点用前不要写入本案事实。旧案只对照案由与证据缺口。",
  },
  {
    id: "materials.draft",
    label: "写材料",
    skillIds: [
      "intake-required-inputs",
      "legal-element-extraction",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "未锁时优先 `execute_workflow`；锁路径按本轮工具表。待审核稿只称初稿/供审核稿，不得写成可对外签发。",
  },
  {
    id: "mail.contract",
    label: "邮件合同审阅",
    skillIds: ["citation-grounding", "delivery-language"],
    pipeline: "tracked_redline",
    pipelineHint: "路径已钉选：按邮件合同短路径 + 最小修改落改；禁止再发现材料。空修订不得导出。",
  },
  {
    id: "analysis.quick",
    label: "法律快问",
    skillIds: [
      "quick-legal-triage",
      "legal-element-extraction",
      "practice-defaults",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "research_then_draft",
    pipelineHint: "直接给出结论、依据和缺口；不要改成表单或空回复。能检索则检索。",
  },
  {
    id: "contract.draft",
    label: "合同起草",
    skillIds: [
      "contract-drafting-route",
      "practice-defaults",
      "intake-required-inputs",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "未锁时优先 `execute_workflow` / `draft_document`；锁路径按本轮工具表。路由卡 + 条款骨架；缺口写在稿里。",
  },
  {
    id: "labor.calc",
    label: "劳动计算",
    skillIds: [
      "labor-compensation-calc",
      "legal-element-extraction",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "金额必须调用 `calculate`（economic_compensation / overtime_pay / double_wage）。模型只填槽，不得口算交差。缺流水仍交付已能确定的段。",
  },
  {
    id: "chronology.timeline",
    label: "时间轴",
    skillIds: ["chronology-from-materials", "legal-element-extraction", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "从已附材料抽日期事件并去重；读不到的日期标缺口，不要编。",
  },
  {
    id: "matter.intake",
    label: "整理案卷",
    skillIds: [
      "matter-from-materials",
      "matter-budget-lite",
      "matter-status-report",
      "legal-element-extraction",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "扫描已附材料归位并抽出当事人、案由、日期；不要先做冲突问卷。",
  },
  {
    id: "period.calc",
    label: "期限计算",
    skillIds: ["legal-period-calc", "citation-grounding", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "届满日必须调用 `calculate`（legal_period）。模型只填起算日和期间种类。",
  },
  {
    id: "ops.invoice",
    label: "整理发票",
    skillIds: ["invoice-organizer", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "归类列表入卷；合计用 `calculate`。缺号码仍列出已有项。",
  },
  {
    id: "ops.court_sms",
    label: "法院短信",
    skillIds: [
      "court-sms-intake",
      "legal-event-extract",
      "chronology-from-materials",
      "legal-period-calc",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "抽出案号与开庭时间；能算的期限用 `calculate`。不要编尚未出现的文书。",
  },
  {
    id: "ip.dispute",
    label: "知产争议",
    skillIds: [
      "ip-dispute-route",
      "legal-element-extraction",
      "evidence-argument-chain",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "权利基础与被控行为分栏；不要套普通民事起诉状。能检索则核权利稳定性。",
  },
  {
    id: "deal.ma",
    label: "并购尽调",
    skillIds: [
      "ma-diligence-route",
      "legal-element-extraction",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "尽调提纲 + 已核/未看到文件清单。未看到的文件不要写成已确认事实。",
  },
  {
    id: "compliance.data",
    label: "数据合规",
    skillIds: [
      "data-compliance-route",
      "research-query-matrix",
      "norm-validity",
      "citation-grounding",
      "delivery-language",
    ],
    pipeline: "research_then_draft",
    pipelineHint: "个保法/数安法/网安法栏目。新闻不得写成现行法。无检索仍保留栏目并标【待核实】。",
  },
  {
    id: "compliance.ads",
    label: "广告产品合规",
    skillIds: ["ads-compliance-route", "norm-validity", "citation-grounding", "delivery-language"],
    pipeline: "research_then_draft",
    pipelineHint:
      "广告用语和标签分栏。绝对化用语标出。不要改成数据出境或合同审查。无检索仍出改法。",
  },
  {
    id: "matter.status",
    label: "办案周报",
    skillIds: [
      "matter-status-report",
      "matter-budget-lite",
      "legal-period-calc",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint:
      "阶段、期限、范围变更、置信。本地顾问工作包、人力安排、沟通计划走同一办件。冲突两说并列。",
  },
  {
    id: "family.matter",
    label: "家事继承",
    skillIds: [
      "family-matter-route",
      "legal-element-extraction",
      "complaint-elements-fill",
      "legal-period-calc",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "按家事程序写。子女利益与财产分栏。不要套借贷起诉状。",
  },
  {
    id: "capital.markets",
    label: "资本市场",
    skillIds: ["capital-markets-route", "citation-grounding", "norm-validity", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "发行/披露核对清单。未看到的数字标【待核实】。不要改成股权融资 Word 改稿。",
  },
  {
    id: "corp.governance",
    label: "公司治理",
    skillIds: [
      "governance-route",
      "legal-element-extraction",
      "norm-validity",
      "delivery-language",
    ],
    pipeline: "execute_workflow",
    pipelineHint: "按股东会/董事会程序写决议或治理备忘。不要改成章程 Word 红线。",
  },
];

const BY_ID = new Map(LAWYER_CAPABILITIES.map((c) => [c.id, c]));

export function getLawyerCapability(id: LawyerCapabilityId): LawyerCapability | undefined {
  return BY_ID.get(id);
}

export function listLawyerCapabilities(): readonly LawyerCapability[] {
  return LAWYER_CAPABILITIES;
}

function boundFromId(
  id: LawyerCapabilityId,
  deliverableType?: DeliverableType,
): BoundLawyerCapability | null {
  const cap = BY_ID.get(id);
  if (!cap) {
    return null;
  }
  const fromDesk = deskItemById(id)?.defaultDeliverableType;
  return {
    ...cap,
    deliverableType: deliverableType ?? (fromDesk as DeliverableType | undefined),
  };
}

export function hydrateCompiledIntent(compiled: CompiledIntent): BoundLawyerCapability | null {
  if (!compiled.capabilityId) {
    return null;
  }
  const bound = boundFromId(compiled.capabilityId, compiled.deliverableType as DeliverableType);
  if (!bound) {
    return null;
  }
  if (compiled.pipelineOverride === "tracked_redline") {
    const contractRevision = compiled.capabilityId === "contract.review";
    return {
      ...bound,
      skillIds:
        compiled.skillIdsOverride !== undefined
          ? [...compiled.skillIdsOverride]
          : contractRevision
            ? [...WORD_REVISION_SKILL_IDS]
            : bound.skillIds,
      pipeline: "tracked_redline",
      pipelineHint:
        compiled.pipelineHintOverride ??
        "拷贝原 Word → `apply_surgical_edits` → `render_tracked_draft` 写入源文件同目录（原名_日期_01）。禁止 `render_document` 重建，不要准备外发邮件。空修订不得导出。",
      deliverableType:
        (compiled.deliverableType as DeliverableType) ??
        (contractRevision ? "contract.general" : bound.deliverableType),
    };
  }
  if (compiled.deliverableType) {
    return { ...bound, deliverableType: compiled.deliverableType as DeliverableType };
  }
  return bound;
}

/** Bind a productized capability. Intent compiler is the SSOT; 办件锁只是覆盖。 */
export function bindLawyerCapability(
  input: BindLawyerCapabilityInput,
): BoundLawyerCapability | null {
  return hydrateCompiledIntent(compileIntent(input));
}

function builtinSkillPath(skillId: string): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin", `${skillId}.md`);
}

export function readBuiltinSkillMarkdown(skillId: string): string | null {
  const file = builtinSkillPath(skillId);
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readSkillPromptBodies(
  workspaceDir: string | undefined,
  skillIds: readonly string[],
  opts?: { skip?: readonly string[] },
): string[] {
  const skip = new Set(opts?.skip ?? []);
  const listed = workspaceDir ? listLocalSkills(workspaceDir) : [];
  const bodies: string[] = [];
  for (const id of skillIds) {
    if (skip.has(id)) {
      continue;
    }
    const hit = listed.find((s) => s.id === id && s.enabled && s.signatureOk);
    let body: string | null = null;
    if (hit) {
      try {
        body = fs.readFileSync(path.join(hit.dir, "SKILL.md"), "utf8");
      } catch {
        body = null;
      }
    }
    if (id === "contract-redline-craft") {
      body = CONTRACT_REDLINE_CRAFT_SKILL;
    }
    body ??= readBuiltinSkillMarkdown(id);
    if (body?.trim()) {
      bodies.push(body.trim());
    }
  }
  return bodies;
}

export function resolveCapabilityPipelineHint(
  bound: BoundLawyerCapability,
  instruction?: string,
): string {
  if (bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return bound.pipelineHint;
  }
  if (instruction && isContractFastLaneInstruction(instruction)) {
    return "必须走 `draft_document` / `update_draft`。按宏观/中观/微观写完意见并给推荐措辞。本回合不检索、不改 Word。缺事实仍交付已完成部分。";
  }
  return bound.pipelineHint;
}

export function formatBoundCapabilityBlock(
  bound: BoundLawyerCapability,
  skillBodies: readonly string[],
  opts?: { indexLines?: readonly string[]; instruction?: string; compiled?: CompiledIntent },
): string {
  const typeLine = bound.deliverableType ? `\n交付物类型：\`${bound.deliverableType}\`` : "";
  const index =
    opts?.indexLines && opts.indexLines.length > 0
      ? ["## 其余技能（索引，不要通读）", ...opts.indexLines.map((line) => `- ${line}`)].join("\n")
      : "";
  const chain =
    opts?.compiled && opts.compiled.chain.length > 1
      ? `组合：${opts.compiled.chain.join(" → ")}。`
      : "";
  const inferred = opts?.compiled?.lawyerSummary
    ? `${opts.compiled.lawyerSummary}。按材料与交办执行，不要再问律师选分类。`
    : "由系统根据材料与交办推断。按推断执行，不要再问律师选分类。";
  return [
    `## 本轮 LawMind 能力：${bound.label}`,
    `能力 ID：\`${bound.id}\`。这是产品化办件（Skill + 流水线 + 验收），不是自由发挥。${typeLine}`,
    resolveCapabilityPipelineHint(bound, opts?.instruction),
    inferred,
    chain,
    ...skillBodies,
    index,
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");
}
