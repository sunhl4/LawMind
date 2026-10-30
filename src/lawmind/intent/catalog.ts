/**
 * Capability catalog for `read_skill` / internal bind. Unbound turns inject
 * `formatCapabilityCatalogIndex` (operating rules), not the 23-id list.
 * Hard binds still dump lean Skill bodies.
 *
 * Skill names come from `skills/builtin/*.md` frontmatter (`id` + `description`).
 * That is Anthropic Agent Skills level 1: metadata stays in the prompt, the body
 * loads only when `read_skill` runs.
 * https://github.com/anthropics/skills
 * https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deskItemById,
  LAWYER_CAPABILITY_IDS,
  type LawyerCapabilityId,
} from "../skills/lawyer-capability-lock.js";

export const CAPABILITY_CATALOG_MAX_CHARS = 8000;

export type CapabilityCatalogEntry = {
  id: LawyerCapabilityId;
  label: string;
  description: string;
  allowImplicit: boolean;
};

const DESCRIPTIONS: Record<LawyerCapabilityId, string> = {
  "contract.review":
    "审已有合同/协议：意见+红线。触发：审查、审阅、风险、已附合同且律师要审。不要把「看看」或已附合同当成已经锁定审查。不要用于起诉状、从零起草或劳动金额计算。",
  "contract.draft": "从零起草合同/协议骨架。触发：起草、拟定一份合同。已有合同要改时用合同审查。",
  "letter.draft":
    "律师函/催告函/回函。触发：写函、催告、催款。已有函要核对应先读材料指出对错，不要未读就另起一稿。不要当成合同审查。",
  "research.memo": "法规/类案检索备忘。触发：查一下、检索、类案。娱乐事实不要用。",
  "litigation.draft":
    "起诉状/答辩/上诉/代理词等诉讼文书。触发：起诉状、答辩状，或已附诉状。合同审查不要走这里。",
  "litigation.talk": "谈话/口述整理成需求、案由、证据缺口。触发：谈话记录、客户说了。",
  "materials.draft": "意见书/备忘/对照表等一般材料。表格汇总走这里。",
  "mail.contract": "邮箱来件合同短路径（仅显式邮件短路径标记）。不要隐式抢对话审查。",
  "analysis.quick": "一句话法律快问：结论+依据+缺口。触发：违法吗、能不能告。正式文书不要走这里。",
  "labor.calc": "经济补偿/加班/双倍工资。触发：N+1、2N、违法解除赔偿。必须走计算引擎。",
  "chronology.timeline": "从材料抽时间轴。触发：时间线、大事记。",
  "matter.intake": "把已附材料归位并抽当事人案由。触发：整理案卷、建立案件目录。",
  "period.calc": "上诉期/答辩期等届满日。触发：期限计算、上诉期届满。",
  "ops.invoice": "发票归类合计。触发：整理发票，或已附发票。",
  "ops.court_sms": "法院短信/传票抽开庭与期限。触发：12368、传票、开庭通知。",
  "ip.dispute": "专利/商标/著作权侵权路径。不要套普通民事起诉状。",
  "deal.ma": "并购/股权收购尽调提纲与交割清单。",
  "compliance.data": "个保法/数安法/数据出境。触发：数据合规、隐私政策。",
  "compliance.ads": "广告用语/产品标签合规。不要改成数据出境或合同审查。",
  "matter.status": "办案周报/结案/人力/沟通计划。",
  "family.matter": "离婚/抚养/继承。不要套买卖合同审查。",
  "capital.markets": "招股/信息披露核对。不编未披露数字。",
  "corp.governance": "股东会/董事会决议与治理备忘。不要改成章程 Word 红线。",
};

export function capabilityCatalogEntry(id: LawyerCapabilityId): CapabilityCatalogEntry {
  const item = deskItemById(id);
  return {
    id,
    label: item?.label ?? id,
    description: DESCRIPTIONS[id],
    allowImplicit: id !== "mail.contract",
  };
}

export function listCapabilityCatalog(): CapabilityCatalogEntry[] {
  return LAWYER_CAPABILITY_IDS.map(capabilityCatalogEntry);
}

const BUILTIN_SKILL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills/builtin",
);

let skillNameIndexCache: readonly (readonly [string, string])[] | undefined;

/** Level-1 skill metadata. Cached; the Markdown body is not loaded here. */
export function builtinSkillNameIndex(): readonly (readonly [string, string])[] {
  if (skillNameIndexCache) {
    return skillNameIndexCache;
  }
  const rows: (readonly [string, string])[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(BUILTIN_SKILL_DIR).filter((name) => name.endsWith(".md"));
  } catch {
    names = [];
  }
  for (const name of names) {
    let raw = "";
    try {
      raw = fs.readFileSync(path.join(BUILTIN_SKILL_DIR, name), "utf8");
    } catch {
      continue;
    }
    const id = /^id:\s*(\S+)\s*$/m.exec(raw)?.[1];
    const description = /^description:\s*(.+)\s*$/m.exec(raw)?.[1]?.trim();
    if (!id || !description) {
      continue;
    }
    // Index lines must not reuse the ledger token the factor state also emits.
    rows.push([id, description.replaceAll("【待核实】", "待核实")]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  skillNameIndexCache = rows;
  return rows;
}

export function formatSkillNameIndex(): string {
  return [
    "## 技能索引",
    "需要某类写法时调用 `read_skill`，参数 `skill_id` 用下面的 id。这不是办件菜单，不要先选一条再开工。",
    ...builtinSkillNameIndex().map(([id, line]) => `- \`${id}\`：${line}`),
  ].join("\n");
}

export function formatCapabilityCatalogIndex(): string {
  const out = [
    "## 本轮怎么做",
    "- 以律师本轮原话和已读材料为准，不要先对号入座再办事。",
    "- 要交的稿写出 Word：新稿 `draft_document` → `render_document`；已有 Word 要改则 `apply_surgical_edits` → `render_tracked_draft`，不要重建原件。点名的文书用对应模板；没点名用 `word/working-draft-default`。",
    "- 只要口头核对、是非、看一眼：不要另起 Word。判不准时偏向交一份工作稿。",
    "- 条号、金额、期限用工具，不要编。缺口写进稿里后仍交稿，不要为凑栏目停下来问。",
    formatSkillNameIndex(),
  ].join("\n");
  if (out.length <= CAPABILITY_CATALOG_MAX_CHARS) {
    return out;
  }
  return `${out.slice(0, CAPABILITY_CATALOG_MAX_CHARS).trimEnd()}\n…`;
}

export function looksLikeLegalWork(instruction: string, hasMaterials: boolean): boolean {
  if (hasMaterials) {
    return true;
  }
  const t = instruction.trim();
  if (t.length < 4) {
    return false;
  }
  return /合同|协议|起诉|答辩|函|法|案|审查|起草|检索|条款|诉讼|合规|尽调|发票|传票|文件夹|目录/.test(
    t,
  );
}
