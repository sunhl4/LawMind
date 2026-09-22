/**
 * Scene scaffolds for 家事 / 资本市场 / 公司治理.
 * Independent of NC copilot and of Word revision packs.
 */

import { formatLitigationStageLine } from "../litigation/litigation-stage.js";
import {
  ADS_COMPLIANCE_RE,
  APPEAL_RE,
  BANKRUPTCY_RE,
  CAPITAL_MARKETS_RE,
  CIVIL_STAGE_RE,
  CRIMINAL_MATTER_RE,
  ENFORCEMENT_RE,
  FAMILY_MATTER_RE,
  FILING_PACK_RE,
  GOVERNANCE_RE,
  MATTER_INTAKE_RE,
} from "../skills/capability-patterns.js";
import type { ArtifactSection } from "../types.js";
import { extractEvidenceChain, formatEvidenceChainBlock } from "./evidence-chain.js";

function placeholder(label: string): string {
  return `【${label}】`;
}

export const FAMILY_INSTRUCTION_RE = FAMILY_MATTER_RE;
export const CAPITAL_INSTRUCTION_RE = CAPITAL_MARKETS_RE;
export const GOVERNANCE_INSTRUCTION_RE = GOVERNANCE_RE;
export const INTAKE_INSTRUCTION_RE = MATTER_INTAKE_RE;
export const CRIMINAL_INSTRUCTION_RE = CRIMINAL_MATTER_RE;
export const BANKRUPTCY_INSTRUCTION_RE = BANKRUPTCY_RE;
export const ADS_COMPLIANCE_INSTRUCTION_RE = ADS_COMPLIANCE_RE;
export const APPEAL_INSTRUCTION_RE = APPEAL_RE;
export const ENFORCEMENT_INSTRUCTION_RE = ENFORCEMENT_RE;
export const FILING_PACK_INSTRUCTION_RE = FILING_PACK_RE;
export const CIVIL_STAGE_INSTRUCTION_RE = CIVIL_STAGE_RE;

export function buildFamilyMatterSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "事实",
      body: `程序：离婚 / 抚养探望 / 继承。文首写阶段（冷静期、一审、执行）。\n${placeholder("已能确定的事实")}${supplement}`,
    },
    {
      heading: "争点",
      body: `- ${placeholder("程序争点与实体争点分开写")}`,
    },
    {
      heading: "请求",
      body: `子女利益与财产分栏，不要写成一笔借贷账。\n- ${placeholder("诉讼请求或主张")}`,
    },
    {
      heading: "证据",
      body: `- ${placeholder("权利/身份/财产清单；缺的待补充")}`,
    },
    {
      heading: "子女利益",
      body: `- ${placeholder("抚养、探望、生活费；不要和财产分割混写")}`,
    },
    {
      heading: "财产",
      body: `- ${placeholder("婚内财产、遗产份额或分割方案；与子女利益分栏")}`,
    },
    {
      heading: "对方抗辩",
      body: `- ${placeholder("已知或可预见的抗辩")}`,
    },
  ];
}

export function buildCapitalMarketsSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "概述",
      body: `文件种类：招股 / 发行 / 定期报告 / 临时公告 / 持续督导。\n${placeholder("已附文件名")}${supplement}`,
    },
    {
      heading: "分析",
      body: `已核段落：${placeholder("页码或节名")}\n未看到的文件：${placeholder("不要写成已确认事实")}`,
    },
    {
      heading: "数字来源",
      body: `只用来源页。缺的【待核实】，不用行业常识补。\n- ${placeholder("数字 → 页")}`,
    },
    {
      heading: "披露时点",
      body: `定期报告 / 临时公告时点：${placeholder("已核日期")}\n逾期或漏披不要写成「已合规」。`,
    },
    {
      heading: "结论",
      body: `${placeholder("核对结论")}。不要写「可以报会」或「已合规」，除非材料齐且交办明确要求结论档。本稿不是股权融资 Word 改稿。`,
    },
  ];
}

export function buildGovernanceSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "事项",
      body: `会议：股东会 / 董事会 / 监事会（或审计委员会）。召集、通知、表决比例。\n${placeholder("已能确定的程序")}${supplement}`,
    },
    {
      heading: "职权依据",
      body: `现行《公司法》名称+可能条号。查不到标【待核实】。\n${placeholder("职权")}`,
    },
    {
      heading: "议案",
      body: `关联交易、对外担保、利润分配分开写。\n- ${placeholder("议案")}`,
    },
    {
      heading: "回避",
      body: `- ${placeholder("关联董事/股东是否表决")}`,
    },
    {
      heading: "结论",
      body: `${placeholder("决议草案或治理备忘结论")}（本稿不代替章程 Word 红线）`,
    },
    {
      heading: "待办",
      body: `- ${placeholder("是否还要改章程或办登记")}；日期：${placeholder("截止日期")}`,
    },
  ];
}

export function buildCriminalMatterSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "事实",
      body: `阶段：咨询 / 侦查 / 审查起诉 / 一审 / 二审 / 死刑复核。不要套民事起诉状。\n${placeholder("强制措施、案由")}${supplement}`,
    },
    {
      heading: "争点",
      body: `- ${placeholder("程序争点与实体争点")}`,
    },
    {
      heading: "请求",
      body: `- ${placeholder("取保、不起诉、无罪或罪轻、量刑")}`,
    },
    {
      heading: "证据",
      body: `主张 → 要件 → 待证事实 → 证据 → 证明力（强/中/弱/待补）。\n- ${placeholder("证据或待补充")}`,
    },
    {
      heading: "对方抗辩",
      body: `- ${placeholder("指控逻辑与反驳")}`,
    },
  ];
}

export function buildBankruptcyMatterSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "事项",
      body: `阶段：申请受理 / 债权申报 / 债权人会议 / 重整 / 和解 / 清算。\n${placeholder("债务人与管理人")}${supplement}`,
    },
    {
      heading: "说明",
      body: `债权申报表不要写成起诉状。重整计划与清算分配分开写。\n- ${placeholder("已能确定的申报或计划要点")}`,
    },
    {
      heading: "期限",
      body: `- ${placeholder("申报截止或表决日")}；能算用 calculate`,
    },
    {
      heading: "结论",
      body: `${placeholder("本阶段应交材料")}；缺管理人信息标【待补充】仍出稿`,
    },
    {
      heading: "下一步",
      body: `- ${placeholder("申报、表决或补材料")}；日期：${placeholder("截止日期")}`,
    },
  ];
}

export function buildAdsComplianceSections(supplement: string): ArtifactSection[] {
  return [
    {
      heading: "事项",
      body: `场景：广告 / 包装标签 / 产品说明。\n${placeholder("媒介、商品或服务")}${supplement}`,
    },
    {
      heading: "用语",
      body: `已核用语：${placeholder("原文摘句")}\n绝对化或误导：${placeholder("绝对、国家级、第一、治疗等")}`,
    },
    {
      heading: "依据",
      body: `广告法 / 反不正当竞争法 / 标签标准：名称+可能条号。新闻不得写成现行法。查不到【待核实】。`,
    },
    {
      heading: "结论",
      body: `${placeholder("可继续使用 / 须改哪几句")}。缺画面或投放排期仍出稿，标【待补充】。不要写成数据出境备忘。`,
    },
    {
      heading: "改法",
      body: `- ${placeholder("可替换措辞")}`,
    },
  ];
}

export function buildAppealSections(supplement: string, instruction = ""): ArtifactSection[] {
  const stage = formatLitigationStageLine(instruction || "上诉状");
  const chain = formatEvidenceChainBlock(extractEvidenceChain(instruction || supplement));
  return [
    {
      heading: "事项",
      body: `${stage}\n不服：${placeholder("一审判决或裁定文号")}${supplement}\n不要写成一审起诉状。`,
    },
    {
      heading: "上诉请求",
      body: `- ${placeholder("改判、发回或维持哪一项")}`,
    },
    {
      heading: "事实与理由",
      body: `事实认定：${placeholder("一审哪一节认错")}\n法律适用：${placeholder("哪条用错")}\n程序：${placeholder("有则写，无则写无")}`,
    },
    {
      heading: "证据",
      body: chain,
    },
    {
      heading: "期限",
      body: `- ${placeholder("上诉期起算与届满")}；能算用 calculate`,
    },
  ];
}

export function buildEnforcementObjectionSections(
  supplement: string,
  instruction = "",
): ArtifactSection[] {
  const stage = formatLitigationStageLine(instruction || "执行异议");
  const chain = formatEvidenceChainBlock(extractEvidenceChain(instruction || supplement));
  return [
    {
      heading: "事项",
      body: `${stage}\n执行程序：${placeholder("执行案号")}${supplement}\n不要写成起诉状。`,
    },
    {
      heading: "异议请求",
      body: `- ${placeholder("中止、撤销或排除执行")}`,
    },
    {
      heading: "事实",
      body: `执行行为或标的：${placeholder("查封、扣划或案外人权利")}`,
    },
    {
      heading: "证据",
      body: chain,
    },
    {
      heading: "期限",
      body: `- ${placeholder("异议或复议期间")}；能算用 calculate`,
    },
  ];
}

export function buildFilingPackSections(supplement: string, instruction = ""): ArtifactSection[] {
  const stage = formatLitigationStageLine(instruction || "立案材料清单");
  return [
    {
      heading: "事项",
      body: `${stage}\n拟立案：${placeholder("法院 / 案由")}${supplement}`,
    },
    {
      heading: "材料",
      body: `起诉状、身份证明、证据目录、证据、授权。缺的标【待补】仍列出。\n- ${placeholder("文件名 → 是否已齐")}`,
    },
    {
      heading: "形式",
      body: `份数、是否要电子档、是否要保全。\n- ${placeholder("已能确定的要求")}`,
    },
    {
      heading: "结论",
      body: `${placeholder("现在能不能交立案")}；缺件不挡出清单。`,
    },
    {
      heading: "下一步",
      body: `- ${placeholder("补哪一份")}；日期：${placeholder("截止日期")}`,
    },
  ];
}
