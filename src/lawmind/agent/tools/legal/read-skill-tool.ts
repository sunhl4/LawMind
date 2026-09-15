/**
 * Codex-style on-demand Skill load. Bound turns inject 1–2 bodies;
 * the rest stay as an index until the model calls this tool.
 */

import {
  readBuiltinSkillMarkdown,
  readSkillPromptBodies,
} from "../../../skills/lawyer-capabilities.js";
import { LAWYER_CAPABILITY_DESK_ITEMS } from "../../../skills/lawyer-capability-lock.js";
import { listLocalSkills } from "../../../skills/skill-runtime.js";
import type { AgentTool } from "../../types.js";

export const READ_SKILL_TOOL_NAME = "read_skill";

const MAX_BODY_CHARS = 12_000;

function listEnabledLocalIds(workspaceDir: string | undefined): string[] {
  if (!workspaceDir) {
    return [];
  }
  try {
    return listLocalSkills(workspaceDir)
      .filter((s) => s.enabled && s.signatureOk)
      .map((s) => s.id);
  } catch {
    return [];
  }
}

export const readSkillTool: AgentTool = {
  definition: {
    name: READ_SKILL_TOOL_NAME,
    description:
      "按需读取一份技能正文（builtin 或本机已启用 Skill）。绑定后索引里的技能不要通读，需要时再调用。可传 skill_id（如 contract-review-layers）或律师能力名（如 合同审查）。",
    category: "system",
    parameters: {
      skill_id: {
        type: "string",
        description: "技能 id 或能力名。省略则只返回可读取目录。",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const requested = typeof params.skill_id === "string" ? params.skill_id.trim() : "";
    const catalog = [
      ...LAWYER_CAPABILITY_DESK_ITEMS.map((item) => `${item.id}（${item.label}）`),
      ...listEnabledLocalIds(ctx.workspaceDir).map((id) => `${id}（本机）`),
    ].slice(0, 40);
    if (!requested) {
      return {
        ok: true,
        data: {
          catalog,
          message: "传入 skill_id 读取正文。索引技能不要整份塞进对话。",
        },
      };
    }
    const capability = LAWYER_CAPABILITY_DESK_ITEMS.find(
      (item) =>
        item.id === requested.toLowerCase() ||
        item.label === requested ||
        item.label.toLowerCase() === requested.toLowerCase(),
    );
    if (capability) {
      return {
        ok: true,
        data: {
          skillId: capability.id,
          kind: "capability",
          label: capability.label,
          hint: capability.hint,
          message: `这是能力「${capability.label}」。质量正文在该能力绑定后的 Skill；需要某份 Skill 时再传具体 skill_id（如 contract-review-layers）。`,
        },
      };
    }
    const bodies = readSkillPromptBodies(ctx.workspaceDir, [requested]);
    const body = bodies[0] ?? readBuiltinSkillMarkdown(requested);
    if (!body?.trim()) {
      return {
        ok: false,
        error: `未找到技能 ${requested}。可先不传 skill_id 查看目录。`,
        data: { catalog },
      };
    }
    const clipped =
      body.trim().length > MAX_BODY_CHARS
        ? `${body.trim().slice(0, MAX_BODY_CHARS)}\n…`
        : body.trim();
    return {
      ok: true,
      data: {
        skillId: requested,
        body: clipped,
        truncated: body.trim().length > MAX_BODY_CHARS,
      },
    };
  },
};
