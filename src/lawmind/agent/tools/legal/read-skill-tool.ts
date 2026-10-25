/**
 * Codex-style on-demand Skill load. Bound turns inject 1–2 bodies;
 * the rest stay as an index until the model calls this tool.
 *
 * ## 为什么不设字符数截断
 *
 * 主流 Skill 运行时（Anthropic Agent Skills / Claude Code / Codex）对 `SKILL.md`
 * 是**整篇加载**：体积纪律放在写作规范（篇幅过长就下沉到 `references/`，按需读取），
 * 不在读取路径上切一刀。运行时真要处理「太大」时，那是**上下文预算层**的职责，
 * 因为只有那一层知道模型窗口与水位——本仓就是 `context-budget.ts` 的估算 +
 * `compact.ts` 在阈值处整理历史。
 *
 * 注意别把这条兜底说大：`mid-turn-compact.ts` 的就地省略**只动 user/assistant 正文**
 * （注释写明「不碰 tool 消息，配对安全」），所以工具回包变大时，收敛它的是
 * **阈值触发的 compact**（整条消息进蒸馏），不是 `text-elide.ts` 的头尾保留。
 * 也就是说这里没有「局部裁剪」的兜底——正因如此，才不该在工具层再造一个截断点；
 * 真需要收的时候，让能做整条取舍的那一层去做。
 *
 * 工具层固定字数截断有三个具体毛病（都验证过）：
 * 1. **切成半句规则**：`slice(0, N)` 会落在句子中间，法律规则被切一半比看不到更危险；
 * 2. **没有续读入口**：被切掉的尾部模型再也读不到（对比 `analyze_document` 的 offset/nextOffset）；
 * 3. **保护错路径**：绑定回合的注入（`planLeanSkillPrompt`）本身不设限，卡住按需读反而只卡住探索。
 *
 * 因此这里改成**按 `##` 分节、按名取用**：不截断，但给模型一张带体积的目录，
 * 让它自己决定读哪一节。分节读取时在正文里**具名**列出未读的节（同 `material-blocks.ts`
 * 的「整块取舍 + 具名说明」），使「这次没看到」与「本来就没有」可区分。
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
import { listProductPlaybooks } from "../../../skills/product-playbooks.js";
import type { AgentTool } from "../../types.js";

export const READ_SKILL_TOOL_NAME = "read_skill";

/** 二级标题即一节。三级及以下留在节内，不再拆——继续细分会让「一节」失去语义边界。 */
const SECTION_HEADING_RE = /^##\s+(.+)$/;

export type SkillSection = {
  /** 稳定标识：标题小写、空白转连字符。供模型复述，减少「凭记忆写标题」的漂移。 */
  id: string;
  title: string;
  /** 该节字符数（含标题行）。模型据此判断值不值得读。 */
  chars: number;
  body: string;
};

export type SkillLayout = {
  /** frontmatter + 首个 `##` 之前的标题与导语。任何分节读取都会带上它。 */
  head: string;
  sections: SkillSection[];
  totalChars: number;
};

function sectionId(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeHeading(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 把一份 Skill 正文拆成「头 + 若干 `##` 节」。
 *
 * **不丢内容**：`head` 是首个 `##` 之前的全部行（frontmatter、标题、导语），
 * 每个 `section.body` 从它的 `##` 行起、到下一个 `##` 前一行止；两者按序拼起来
 * 覆盖原文的每一行。这一点由测试锁定（逐行覆盖，不是数长度——分隔空行会被 trim 掉，
 * 拿字符数相加去比必然对不上）。
 *
 * 不需要单独解析 frontmatter：它本来就在首个 `##` 之前，天然属于 `head`。
 * 没有 `##` 的正文整篇就是 `head`，此时 `sections` 为空。
 */
export function splitSkillSections(markdown: string): SkillLayout {
  const text = markdown.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const headLines: string[] = [];
  const rawSections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const line of lines) {
    const heading = SECTION_HEADING_RE.exec(line);
    if (heading) {
      if (current) {
        rawSections.push(current);
      }
      current = { title: heading[1].trim(), lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      headLines.push(line);
    }
  }
  if (current) {
    rawSections.push(current);
  }

  const sections: SkillSection[] = rawSections.map((section) => {
    const body = section.lines.join("\n").trim();
    return {
      id: sectionId(section.title),
      title: section.title,
      chars: body.length,
      body,
    };
  });

  return {
    head: headLines.join("\n").trim(),
    sections,
    totalChars: text.length,
  };
}

/**
 * 返回**下标**而不是对象：同名 `##` 在本仓不存在，但按 id 过滤剩余节会把同名节
 * 一起漏掉（第二个同名节既不在正文里、也不在「未读」清单里 = 静默消失）。
 * 用下标做身份，重名时最多是清单里出现两行同样的标题——那是可见的，不是丢失。
 */
function findSectionIndex(layout: SkillLayout, requested: string): number {
  const wanted = normalizeHeading(requested);
  return layout.sections.findIndex(
    (section) =>
      normalizeHeading(section.title) === wanted ||
      normalizeHeading(section.id) === wanted ||
      normalizeHeading(section.id.replace(/-/g, " ")) === wanted,
  );
}

function formatOutline(sections: readonly SkillSection[]): string[] {
  return sections.map((section) => `${section.title}（${section.chars} 字符）`);
}

export const readSkillTool: AgentTool = {
  definition: {
    name: READ_SKILL_TOOL_NAME,
    description:
      "按需读取一份内置作业标准正文。绑定后索引里的标准不要通读，需要时再调用。可传 skill_id（如 contract-review-layers 或能力名，如「合同审查」）读取整篇；标准较长时先看返回的 outline，再用 section 只读需要的某一节。省略 skill_id 时返回产品目录 + 规范库元数据索引（不装包、不执行第三方正文）。工作区里自行放入的 SKILL.md 不会被读取。",
    category: "system",
    parameters: {
      skill_id: {
        type: "string",
        description: "技能 id 或能力名。省略则只返回可读取目录与规范库索引。",
      },
      section: {
        type: "string",
        description:
          "可选，只读某一节。传 outline 里的节标题（或 id）。省略则读整篇。长标准优先按节读，避免把整篇占进上下文。",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const requested = typeof params.skill_id === "string" ? params.skill_id.trim() : "";
    const requestedSection = typeof params.section === "string" ? params.section.trim() : "";
    const catalog = [
      ...LAWYER_CAPABILITY_DESK_ITEMS.map((item) => `${item.id}（${item.label}）`),
      ...listProductPlaybooks().map((s) => `${s.id}（${s.name}）`),
    ].slice(0, 80);
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
            "规范库索引条目：仅元数据。不要假装已有第三方正文；消化后应写进 builtin，由软件带上，不能安装。",
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

    const text = body.trim();
    const layout = splitSkillSections(text);
    const outline = formatOutline(layout.sections);

    if (!requestedSection || layout.sections.length === 0) {
      return {
        ok: true,
        data: {
          skillId: requested,
          body: text,
          outline,
          totalChars: layout.totalChars,
          ...(requestedSection
            ? { message: `该技能没有分节（无 \`##\` 标题），已返回整篇。` }
            : {}),
        },
      };
    }

    const sectionIndex = findSectionIndex(layout, requestedSection);
    const section = sectionIndex === -1 ? undefined : layout.sections[sectionIndex];
    if (!section) {
      return {
        ok: false,
        error: `技能 ${requested} 没有「${requestedSection}」这一节。可选：${layout.sections
          .map((s) => s.title)
          .join("、")}。`,
        data: { skillId: requested, outline, totalChars: layout.totalChars },
      };
    }

    const remaining = layout.sections.filter((_, index) => index !== sectionIndex);
    const inBandNote =
      remaining.length > 0
        ? `\n\n（本次只读了「${section.title}」一节；未读：${remaining
            .map((s) => s.title)
            .join("、")}。需要时再传 section。）`
        : "";
    return {
      ok: true,
      data: {
        skillId: requested,
        section: section.title,
        body: [layout.head, section.body].filter(Boolean).join("\n\n") + inBandNote,
        outline,
        remainingSections: remaining.map((s) => s.title),
        totalChars: layout.totalChars,
      },
    };
  },
};
