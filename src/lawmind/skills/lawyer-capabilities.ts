/**
 * High-frequency lawyer work, productized as LawMind capabilities.
 * Each capability = Skill(s) + pipeline + acceptance — not free-form chat.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { isWordRevisionTurn } from "../platform/word-revision-instruction.js";
import { deliverableTypeFromInstruction } from "../router/intake-gate.js";
import type { DeliverableType } from "../types.js";
import {
  deskItemById,
  parseCapabilityLock,
  type LawyerCapabilityId,
} from "./lawyer-capability-lock.js";
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

export type BindLawyerCapabilityInput = {
  instruction: string;
  deliverableType?: DeliverableType;
  mailFastPath?: boolean;
  pins?: ComposeContextPin[];
  /** When set (办件列表选定)，优先于关键词推断。 */
  capabilityId?: LawyerCapabilityId;
};

const RESEARCH_FALLBACK_RE = /(查一下|检索|法规|法条|类案|司法解释|研究一下|调研)/;

export const LAWYER_CAPABILITIES: readonly LawyerCapability[] = [
  {
    id: "contract.review",
    label: "合同审查",
    skillIds: ["contract-redline-craft", "citation-grounding", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint:
      "必须走 `execute_workflow`，或 `apply_surgical_edits` + `craft_check`；不得用聊天正文代替可验收审查意见/红线。空修订不得导出。",
  },
  {
    id: "letter.draft",
    label: "函件起草",
    skillIds: ["intake-required-inputs", "citation-grounding", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint:
      "必须走 `execute_workflow` / `draft_document`。缺收件人且无材料时才硬澄清；否则边写边标【待补充】。",
  },
  {
    id: "research.memo",
    label: "检索研究",
    skillIds: ["citation-grounding", "delivery-language"],
    pipeline: "research_then_draft",
    pipelineHint:
      "先 `research_task` / 检索工具，再按引用锚定起草；不得凭记忆编造法条原文。正式备忘走 `execute_workflow`。",
  },
  {
    id: "litigation.draft",
    label: "诉讼文书",
    skillIds: ["intake-required-inputs", "citation-grounding", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "必须走 `execute_workflow`。主体/诉请缺口标【待补充】或硬澄清，不得空跑外发。",
  },
  {
    id: "materials.draft",
    label: "写材料",
    skillIds: ["intake-required-inputs", "citation-grounding", "delivery-language"],
    pipeline: "execute_workflow",
    pipelineHint: "必须走 `execute_workflow`。待审核稿只称初稿/供审核稿，不得写成可对外签发。",
  },
  {
    id: "mail.contract",
    label: "邮件合同审阅",
    skillIds: ["citation-grounding", "delivery-language"],
    pipeline: "tracked_redline",
    pipelineHint: "路径已钉选：按邮件合同短路径 + 最小修改落改；禁止再发现材料。空修订不得导出。",
  },
];

const BY_ID = new Map(LAWYER_CAPABILITIES.map((c) => [c.id, c]));

export function getLawyerCapability(id: LawyerCapabilityId): LawyerCapability | undefined {
  return BY_ID.get(id);
}

export function listLawyerCapabilities(): readonly LawyerCapability[] {
  return LAWYER_CAPABILITIES;
}

function capabilityForDeliverableType(dt: string): LawyerCapability | undefined {
  if (dt === "contract.review") {
    return BY_ID.get("contract.review");
  }
  if (dt.startsWith("letter.")) {
    return BY_ID.get("letter.draft");
  }
  if (dt.startsWith("litigation.")) {
    return BY_ID.get("litigation.draft");
  }
  if (dt.startsWith("report.") || dt === "ppt.training") {
    return BY_ID.get("research.memo");
  }
  if (
    dt.startsWith("memo.") ||
    dt.startsWith("matter.") ||
    dt.startsWith("contract.") ||
    dt === "meeting.minutes" ||
    dt === "document.general"
  ) {
    return BY_ID.get("materials.draft");
  }
  return undefined;
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

/** Bind a productized capability. 办件锁优先；口头答疑不绑定。 */
export function bindLawyerCapability(
  input: BindLawyerCapabilityInput,
): BoundLawyerCapability | null {
  const instruction = input.instruction.trim();
  const lockedId = input.capabilityId ?? parseCapabilityLock(instruction);
  if (lockedId) {
    return boundFromId(lockedId, input.deliverableType);
  }
  if (!instruction || instruction.length < 4) {
    return null;
  }
  const mailFastPath = input.mailFastPath ?? isMailContractFastPathInstruction(instruction);
  if (mailFastPath) {
    return boundFromId("mail.contract", "contract.review");
  }
  if (
    isWordRevisionTurn({
      instruction,
      pins: input.pins,
    })
  ) {
    const cap = BY_ID.get("contract.review");
    if (cap) {
      return {
        ...cap,
        pipeline: "tracked_redline",
        pipelineHint:
          "拷贝原 Word → `apply_surgical_edits` → `render_tracked_draft` 写入源文件同目录（原名_日期_01）。禁止 `render_document` 重建，不要准备外发邮件。空修订不得导出。",
        deliverableType: "contract.general",
      };
    }
  }
  const dt = input.deliverableType ?? deliverableTypeFromInstruction(instruction);
  if (dt) {
    const cap = capabilityForDeliverableType(dt);
    if (cap) {
      return { ...cap, deliverableType: dt };
    }
  }
  if (RESEARCH_FALLBACK_RE.test(instruction)) {
    return boundFromId("research.memo");
  }
  return null;
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
    body ??= readBuiltinSkillMarkdown(id);
    if (body?.trim()) {
      bodies.push(body.trim());
    }
  }
  return bodies;
}

export function formatBoundCapabilityBlock(
  bound: BoundLawyerCapability,
  skillBodies: readonly string[],
): string {
  const typeLine = bound.deliverableType ? `\n交付物类型：\`${bound.deliverableType}\`` : "";
  return [
    `## 本轮 LawMind 能力：${bound.label}`,
    `能力 ID：\`${bound.id}\`。这是产品化办件（Skill + 流水线 + 验收），不是自由发挥。${typeLine}`,
    bound.pipelineHint,
    "本流程由律师在「办件」选定或指令已带能力锁；按锁执行，不要靠激活词猜测。",
    ...skillBodies,
  ].join("\n\n");
}
