/**
 * Codex-style capability catalog: name + description for implicit match,
 * plus when/notWhen boundaries. Injected on unbound turns and on soft
 * keyword/matter/genre hypotheses. Hard binds still dump lean Skill bodies.
 */

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

/** Codex-style session catalog (name + description), capped. */
export function formatCapabilityCatalogIndex(): string {
  const lines = [
    "## 可用能力（隐式选用；律师不必点选）",
    "先按律师本轮原话判断要做什么。需要某条能力的质量规范时调用 `read_skill`。多条适用时取最小充分集。邮件合同短路径仅在指令已带短路径标记时使用。",
  ];
  for (const entry of listCapabilityCatalog()) {
    if (!entry.allowImplicit) {
      continue;
    }
    lines.push(`- ${entry.id}（${entry.label}）：${entry.description}`);
  }
  let out = lines.join("\n");
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
