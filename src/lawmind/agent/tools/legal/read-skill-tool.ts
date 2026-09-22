/**
 * Codex-style on-demand Skill load. Bound turns inject 1–2 bodies;
 * the rest stay as an index until the model calls this tool.
 */

import {
  formatCanonicalSkillIndexCatalog,
  lookupCanonicalSkillIndex,
} from "../../../skills/census/canonical-skill-index.js";
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
      "按需读取一份技能正文（builtin 或本机已启用 Skill）。绑定后索引里的技能不要通读，需要时再调用。可传 skill_id（如 contract-review-layers）或律师能力名（如 合同审查）。省略 skill_id 时返回可执行目录 + 规范库元数据索引（不装包、不执行第三方正文）。",
    category: "system",
    parameters: {
      skill_id: {
        type: "string",
        description: "技能 id 或能力名。省略则只返回可读取目录与规范库索引。",
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
    const externalIndex = formatCanonicalSkillIndexCatalog(40);
    if (!requested) {
      return {
        ok: true,
        data: {
          catalog,
          externalIndex,
          message:
            "传入 skill_id 读取可执行正文。externalIndex 是规范库元数据（发现/消化用），不装包、不执行。",
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
    const canonical = lookupCanonicalSkillIndex(requested);
    if (canonical) {
      return {
        ok: true,
        data: {
          skillId: canonical.id,
          kind: "canonical_index",
          label: canonical.label,
          sourceRepo: canonical.sourceRepo,
          licenseAbsorb: canonical.licenseAbsorb,
          mapsToCapabilityId: canonical.mapsToCapabilityId,
          when: canonical.when,
          notWhen: canonical.notWhen,
          body: undefined,
          message:
            "规范库索引条目：仅元数据。不要假装已装第三方 SKILL 正文；消化后应落成本机/builtin Skill 再执行。",
        },
      };
    }
    const bodies = readSkillPromptBodies(ctx.workspaceDir, [requested]);
    const body = bodies[0] ?? readBuiltinSkillMarkdown(requested);
    if (!body?.trim()) {
      return {
        ok: false,
        error: `未找到技能 ${requested}。可先不传 skill_id 查看目录与规范库索引。`,
        data: { catalog, externalIndex },
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
