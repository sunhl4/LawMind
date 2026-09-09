/**
 * Rule-based reasoning: ResearchBundle -> ArtifactDraft
 */

import {
  extractComplaintCompileFill,
  extractLiabilityCapCompileFill,
} from "../compile/complaint-liability-adapters.js";
import {
  extractLaborCompileFill,
  extractPeriodCompileFill,
} from "../compile/labor-period-adapters.js";
import { letterAddressSlots } from "../compile/letter-fill.js";
import {
  inferClosedContractType,
  formatClosedContractTypeLine,
  formatLayeredReviewBodies,
} from "../contracts/closed-contract-type.js";
import {
  appendProvenanceEvent,
  createProvenanceEvent,
  type ProvenanceChain,
} from "../drafts/provenance.js";
import { formatSourceBoundaryBody, formatSignOffLine } from "../drafts/source-boundary.js";
import {
  formatLaborArbitrationBody,
  formatLaborCalcBody,
  type LaborCalcFill,
} from "../labor/labor-calc-fill.js";
import { formatPeriodCalcBody, type PeriodCalcFill } from "../labor/period-calc-fill.js";
import {
  formatComplaintClaimsBlock,
  formatComplaintClosingBlock,
  formatComplaintEvidenceBlock,
  formatComplaintFactsBlock,
  formatComplaintPartyBlock,
  type ComplaintFillPlan,
} from "../litigation/complaint-fill-plan.js";
import { formatLitigationStageLine } from "../litigation/litigation-stage.js";
import { inferDealRole, inferPaperSide } from "../practice/bilateral-review.js";
import { formatLiabilityCapBody, type LiabilityCapFill } from "../practice/liability-cap.js";
import {
  buildLpmMemoSections,
  buildMatterIntakeSections,
  inferLpmMemoKind,
  lpmMemoTitle,
} from "../practice/lpm-matter-columns.js";
import { buildQueryMatrix, formatQueryMatrixBody } from "../research/query-matrix.js";
import type { ResearchOutline } from "../research/research-outline.js";
import { outlineClarificationQuestion } from "../research/research-outline.js";
import { formatUnretrievedStatuteBody } from "../research/research-protocol.js";
import { QUICK_TRIAGE_RE } from "../skills/capability-patterns.js";
import type { ArtifactDraft, ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";
import { formatChronologyBody } from "./chronology-extract.js";
import {
  buildComplianceReportSections,
  buildLearningBriefSections,
  inferComplianceTitle,
  inferLearningTitle,
} from "./compliance-learning-draft.js";
import {
  buildEsgReportSections,
  buildGeneralReportSections,
  inferEsgReportTitle,
} from "./esg-report-draft.js";
import { extractEvidenceChain, formatEvidenceChainBlock } from "./evidence-chain.js";
import { extractLegalElements, formatLegalElementsBody } from "./legal-elements.js";
import { formatNormValidityBody } from "./norm-validity.js";
import { formatQuickTriageBandLine } from "./quick-triage.js";
import {
  buildOutlineOnlySections,
  isOutlineGatedDeliverable,
  resolveOutlineForDraft,
  trainingDesenseGateOrThrow,
} from "./research-draft-gates.js";
import {
  CAPITAL_INSTRUCTION_RE,
  FAMILY_INSTRUCTION_RE,
  GOVERNANCE_INSTRUCTION_RE,
  INTAKE_INSTRUCTION_RE,
  CRIMINAL_INSTRUCTION_RE,
  BANKRUPTCY_INSTRUCTION_RE,
  ADS_COMPLIANCE_INSTRUCTION_RE,
  APPEAL_INSTRUCTION_RE,
  ENFORCEMENT_INSTRUCTION_RE,
  FILING_PACK_INSTRUCTION_RE,
  buildCapitalMarketsSections,
  buildFamilyMatterSections,
  buildGovernanceSections,
  buildCriminalMatterSections,
  buildBankruptcyMatterSections,
  buildAdsComplianceSections,
  buildAppealSections,
  buildEnforcementObjectionSections,
  buildFilingPackSections,
} from "./scene-draft.js";
import {
  buildTrainingPptSections,
  inferTrainingDeckVariant,
  inferTrainingTitle,
  trainingTemplateIdForVariant,
} from "./training-ppt-draft.js";

export type BuildDraftParams = {
  intent: TaskIntent;
  bundle: ResearchBundle;
  title?: string;
  templateId?: string;
  /** LawMind data root for draft-with-model preference (desktop models.json). */
  lawMindRoot?: string;
  /** Workspace root — enables outline persistence + matter desense scan. */
  workspaceDir?: string;
};

function sectionFromClaims(
  bundle: ResearchBundle,
  headingBuilder: (index: number) => string = (index) => `要点 ${index + 1}`,
): ArtifactSection[] {
  if (bundle.claims.length === 0) {
    return [
      {
        heading: "检索结果",
        body: "当前未检索到可引用结论，请补充检索来源后重试。",
      },
    ];
  }

  return bundle.claims.map((claim, idx) => ({
    heading: headingBuilder(idx),
    body: `${claim.text}\n置信度：${Math.round(claim.confidence * 100)}%`,
    citations: claim.sourceIds,
  }));
}

function buildSectionProvenance(
  section: ArtifactSection,
  bundle: ResearchBundle,
  taskId: string,
  deliverableType?: string,
): ProvenanceChain {
  let chain: ProvenanceChain = { events: [] };
  for (const sourceId of section.citations ?? []) {
    const source = bundle.sources.find((s) => s.id === sourceId);
    chain = appendProvenanceEvent(
      chain,
      createProvenanceEvent("upload", "system", {
        sourceId,
        comment: source?.title?.trim() || "材料来源",
      }),
    );
  }
  chain = appendProvenanceEvent(
    chain,
    createProvenanceEvent("ai_suggest", "model", {
      sourceId: taskId,
      reason: deliverableType,
      comment: section.heading,
    }),
  );
  return chain;
}

export function attachProvenanceToSections(
  sections: ArtifactSection[],
  bundle: ResearchBundle,
  taskId: string,
  deliverableType?: string,
): ArtifactSection[] {
  return sections.map((section) => ({
    ...section,
    provenance: buildSectionProvenance(section, bundle, taskId, deliverableType),
  }));
}

function summarizeBundle(bundle: ResearchBundle): string {
  const sourceCount = bundle.sources.length;
  const claimCount = bundle.claims.length;
  const riskCount = bundle.riskFlags.length;
  const missingCount = bundle.missingItems.length;
  return `共检索 ${sourceCount} 条来源，整理 ${claimCount} 条结论，风险提示 ${riskCount} 条，待补充事项 ${missingCount} 条。`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function isNegative(text: string): boolean {
  return /(不|未|无|不得|不能|禁止|否|not|no|cannot|must not)/i.test(text);
}

function detectClaimConflicts(bundle: ResearchBundle): string[] {
  const groups = new Map<string, Array<{ text: string; negative: boolean; model: string }>>();

  for (const claim of bundle.claims) {
    const key = normalizeText(claim.text).replace(
      /(不|未|无|不得|不能|禁止|否|not|no|cannot|mustnot)/gi,
      "",
    );
    if (!key) {
      continue;
    }
    const current = groups.get(key) ?? [];
    current.push({
      text: claim.text,
      negative: isNegative(claim.text),
      model: claim.model,
    });
    groups.set(key, current);
  }

  const conflicts: string[] = [];
  for (const [, items] of groups) {
    const hasNegative = items.some((it) => it.negative);
    const hasPositive = items.some((it) => !it.negative);
    if (hasNegative && hasPositive) {
      const preview = items.map((it) => `[${it.model}] ${it.text}`).join(" | ");
      conflicts.push(`同主题结论出现冲突：${preview}`);
    }
  }
  return conflicts;
}

function isContractReviewIntent(intent: TaskIntent): boolean {
  return intent.kind === "analyze.contract";
}

function isDeliverableDraftIntent(intent: TaskIntent): boolean {
  if (intent.kind === "draft.word") {
    return true;
  }
  const dt = intent.deliverableType;
  return (
    dt === "memo.research" || dt === "memo.internal" || dt === "labor.calc" || dt === "period.calc"
  );
}

function buildPlaceholder(label: string): string {
  return `【${label}】`;
}

function clarificationTail(intent: TaskIntent): string {
  const questions = intent.clarificationQuestions ?? [];
  if (questions.length === 0) {
    return "";
  }
  return `\n\n待补充：\n${questions.map((item) => `- ${item.question}`).join("\n")}`;
}

function defaultDraftTitle(intent: TaskIntent): string {
  if (intent.deliverableType === "ppt.training" || intent.kind === "draft.ppt") {
    if (intent.deliverableType === "ppt.training") {
      return inferTrainingTitle(intent);
    }
    return "LawMind 客户汇报草稿";
  }
  if (intent.deliverableType === "contract.rental") {
    return "房屋租赁合同";
  }
  if (intent.deliverableType === "contract.general") {
    return "合同草案";
  }
  if (intent.deliverableType === "letter.demand") {
    return "催告函";
  }
  if (intent.deliverableType === "letter.counsel") {
    return "律师函";
  }
  if (intent.deliverableType === "letter.reply") {
    return "回函稿";
  }
  if (intent.deliverableType === "litigation.complaint") {
    return "民事起诉状";
  }
  if (intent.deliverableType === "memo.research") {
    return "检索研究备忘";
  }
  if (intent.deliverableType === "labor.calc") {
    return "劳动补偿计算";
  }
  if (intent.deliverableType === "period.calc") {
    return "程序期限计算";
  }
  if (intent.deliverableType === "litigation.answer") {
    return "民事答辩状";
  }
  if (intent.deliverableType === "litigation.brief") {
    return "代理词";
  }
  if (intent.deliverableType === "memo.opinion") {
    return "法律意见书";
  }
  if (intent.deliverableType === "memo.internal") {
    const lpm = inferLpmMemoKind(intent.instruction);
    if (lpm) {
      return lpmMemoTitle(lpm);
    }
    if (GOVERNANCE_INSTRUCTION_RE.test(intent.instruction)) {
      return "公司治理备忘";
    }
    return "内部备忘";
  }
  if (intent.deliverableType === "matter.timeline") {
    return "案件时间线";
  }
  if (intent.deliverableType === "matter.exhibit_list") {
    return "证据目录";
  }
  if (intent.deliverableType === "meeting.minutes") {
    return "会议纪要";
  }
  if (intent.deliverableType === "contract.nda") {
    return "保密协议";
  }
  if (isContractReviewIntent(intent)) {
    return "合同审查意见书";
  }
  if (intent.deliverableType === "report.esg") {
    return inferEsgReportTitle(intent);
  }
  if (intent.deliverableType === "report.compliance") {
    return inferComplianceTitle(intent);
  }
  if (intent.deliverableType === "report.learning") {
    return inferLearningTitle(intent);
  }
  if (intent.deliverableType === "report.general") {
    if (ADS_COMPLIANCE_INSTRUCTION_RE.test(intent.instruction)) {
      return "广告与产品合规备忘";
    }
    const trimmed = intent.summary?.trim();
    return trimmed && trimmed.length <= 80 ? trimmed : "专项研究报告";
  }
  if (intent.deliverableType === "document.general") {
    if (APPEAL_INSTRUCTION_RE.test(intent.instruction)) {
      return "民事上诉状";
    }
    if (ENFORCEMENT_INSTRUCTION_RE.test(intent.instruction)) {
      return "执行异议";
    }
    if (FILING_PACK_INSTRUCTION_RE.test(intent.instruction)) {
      return "立案材料清单";
    }
  }
  return "LawMind 法律文书草稿";
}

function defaultTemplateId(intent: TaskIntent): string {
  if (intent.deliverableType === "ppt.training") {
    return trainingTemplateIdForVariant(inferTrainingDeckVariant(intent));
  }
  if (intent.output === "pptx") {
    return "ppt/client-brief-default";
  }
  if (
    intent.deliverableType === "letter.demand" ||
    intent.deliverableType === "letter.counsel" ||
    intent.deliverableType === "letter.reply"
  ) {
    return "word/demand-letter-default";
  }
  if (
    intent.deliverableType === "litigation.outline" ||
    intent.deliverableType === "litigation.complaint" ||
    intent.deliverableType === "litigation.answer" ||
    intent.deliverableType === "litigation.brief"
  ) {
    return "word/legal-memo-default";
  }
  if (intent.deliverableType === "contract.nda") {
    return "word/contract-default";
  }
  if (
    intent.deliverableType === "memo.opinion" ||
    intent.deliverableType === "memo.internal" ||
    intent.deliverableType === "memo.research" ||
    intent.deliverableType === "labor.calc" ||
    intent.deliverableType === "period.calc" ||
    intent.deliverableType === "matter.timeline" ||
    intent.deliverableType === "matter.exhibit_list" ||
    intent.deliverableType === "meeting.minutes"
  ) {
    return "word/legal-memo-default";
  }
  if (
    intent.deliverableType === "contract.rental" ||
    intent.deliverableType === "contract.general"
  ) {
    return "word/contract-default";
  }
  if (isContractReviewIntent(intent)) {
    return "word/contract-default";
  }
  if (
    intent.deliverableType === "report.esg" ||
    intent.deliverableType === "report.general" ||
    intent.deliverableType === "report.compliance" ||
    intent.deliverableType === "report.learning"
  ) {
    return "word/legal-memo-default";
  }
  return "word/legal-memo-default";
}

function buildRentalContractSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  return [
    {
      heading: "合同当事人",
      body: `出租人（甲方）：${buildPlaceholder("出租人姓名/名称")}\n证件号码/统一社会信用代码：${buildPlaceholder("甲方证件号码")}\n联系地址：${buildPlaceholder("甲方联系地址")}\n联系电话：${buildPlaceholder("甲方联系电话")}\n\n承租人（乙方）：${buildPlaceholder("承租人姓名/名称")}\n证件号码/统一社会信用代码：${buildPlaceholder("乙方证件号码")}\n联系地址：${buildPlaceholder("乙方联系地址")}\n联系电话：${buildPlaceholder("乙方联系电话")}`,
    },
    {
      heading: "第一条 房屋基本情况",
      body: `1.1 甲方出租给乙方的房屋坐落于：${buildPlaceholder("房屋地址")}。\n1.2 房屋建筑面积约为：${buildPlaceholder("建筑面积")} 平方米，套内面积约为：${buildPlaceholder("套内面积")} 平方米。\n1.3 房屋用途为：${buildPlaceholder("租赁用途")}。\n1.4 房屋附属设施、家具家电及交付清单以双方签署的《房屋交接清单》为准。${supplement}`,
    },
    {
      heading: "第二条 租赁期限与交付",
      body: `2.1 租赁期限自 ${buildPlaceholder("起租日期")} 起至 ${buildPlaceholder("到期日期")} 止。\n2.2 甲方应于 ${buildPlaceholder("交付日期")} 前将房屋按可正常使用状态交付乙方。\n2.3 乙方应于租赁期限届满或合同解除后 ${buildPlaceholder("返还期限")} 内返还房屋，并保持房屋及附属设施符合合理使用后的状态。`,
    },
    {
      heading: "第三条 租金、押金及支付方式",
      body: `3.1 租金标准：每 ${buildPlaceholder("支付周期")} 租金为人民币 ${buildPlaceholder("租金金额")} 元。\n3.2 押金金额：人民币 ${buildPlaceholder("押金金额")} 元。\n3.3 支付方式：乙方应于每期开始前 ${buildPlaceholder("提前支付天数")} 日支付当期租金至甲方指定账户。\n3.4 甲方指定收款账户：${buildPlaceholder("收款账户信息")}。\n3.5 水、电、燃气、物业、供暖、网络及其他费用由 ${buildPlaceholder("费用承担方")} 按实际发生承担。`,
    },
    {
      heading: "第四条 双方权利义务",
      body: `4.1 甲方保证对出租房屋享有合法处分权，房屋不存在影响乙方正常承租使用的权利瑕疵。\n4.2 乙方应按约定用途使用房屋，不得擅自改变房屋结构、用途或进行违法经营活动。\n4.3 未经甲方书面同意，乙方不得擅自转租、转借或与第三人共同使用房屋。\n4.4 甲乙双方均应配合办理与租赁相关的登记、备案或管理手续（如需）。`,
    },
    {
      heading: "第五条 维修、保养与费用承担",
      body: `5.1 房屋主体结构及自然损耗导致的维修责任由甲方承担；因乙方使用不当导致的维修、修复及赔偿责任由乙方承担。\n5.2 乙方应合理使用房屋及附属设施，发现需要维修的，应及时通知甲方。\n5.3 紧急情况下乙方为避免损失扩大而先行处置的，甲方应在合理范围内承担必要费用，但乙方应及时提供凭证。`,
    },
    {
      heading: "第六条 违约责任",
      body: `6.1 乙方逾期支付租金超过 ${buildPlaceholder("逾期天数")} 日的，甲方有权要求乙方按逾期金额每日 ${buildPlaceholder("违约金比例")} 支付违约金。\n6.2 甲方逾期交付房屋超过 ${buildPlaceholder("甲方逾期交付天数")} 日的，乙方有权要求甲方承担相应违约责任。\n6.3 任一方严重违反本合同约定，给对方造成损失的，应承担赔偿责任，包括直接损失及实现债权的合理费用。`,
    },
    {
      heading: "第七条 合同解除与续租",
      body: `7.1 出现下列情形之一的，守约方有权解除合同：\n- 一方严重违约且在收到书面催告后 ${buildPlaceholder("补救期限")} 日内未改正；\n- 因政府征收、拆迁或不可抗力导致合同目的无法实现；\n- 其他依法或依约可以解除合同的情形。\n7.2 租赁期限届满前，如乙方拟继续承租，应至少提前 ${buildPlaceholder("续租通知期限")} 日向甲方提出书面续租申请；双方另行协商续租事宜。`,
    },
    {
      heading: "第八条 争议解决",
      body: `因本合同引起的或与本合同有关的争议，双方应先行协商解决；协商不成的，任一方均可向 ${buildPlaceholder("管辖法院或仲裁机构")} 提起诉讼/申请仲裁。`,
    },
    {
      heading: "第九条 其他约定",
      body: `9.1 本合同未尽事宜，由双方另行签署补充协议，补充协议与本合同具有同等法律效力。\n9.2 本合同自双方签字或盖章之日起生效。\n9.3 本合同一式 ${buildPlaceholder("合同份数")} 份，甲乙双方各执 ${buildPlaceholder("各执份数")} 份，具有同等法律效力。`,
    },
    {
      heading: "签署页",
      body: `出租人（甲方）：________________\n签署日期：________________\n\n承租人（乙方）：________________\n签署日期：________________`,
    },
  ];
}

function buildGeneralContractSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  return [
    {
      heading: "合同当事人",
      body: `甲方：${buildPlaceholder("甲方名称/姓名")}\n乙方：${buildPlaceholder("乙方名称/姓名")}\n双方联系人及联系方式：${buildPlaceholder("联系方式")}`,
    },
    {
      heading: "第一条 合同标的",
      body: `合同标的：${buildPlaceholder("标的描述")}\n规格/数量/质量要求：${buildPlaceholder("规格数量质量要求")}${supplement}`,
    },
    {
      heading: "第二条 价款与支付安排",
      body: `合同总价款：人民币 ${buildPlaceholder("总价款")} 元。\n支付节点与方式：${buildPlaceholder("支付节点与支付方式")}。`,
    },
    {
      heading: "第三条 履行方式与期限",
      body: `履行地点：${buildPlaceholder("履行地点")}。\n履行期限：${buildPlaceholder("履行期限")}。\n交付/验收标准：${buildPlaceholder("交付或验收标准")}。`,
    },
    {
      heading: "第四条 违约责任",
      body: `任一方违约的，应承担继续履行、采取补救措施、赔偿损失等违约责任；具体违约金及赔偿规则如下：${buildPlaceholder("违约责任规则")}。`,
    },
    {
      heading: "第五条 争议解决",
      body: `因本合同产生的争议，由双方协商解决；协商不成的，提交 ${buildPlaceholder("争议解决机构")} 处理。`,
    },
    {
      heading: "签署页",
      body: `甲方（签字/盖章）：________________\n日期：________________\n\n乙方（签字/盖章）：________________\n日期：________________`,
    },
  ];
}

function buildDemandLetterSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const { to, client } = letterAddressSlots(intent.instruction);
  return [
    {
      heading: "收函人",
      body: `致：${to}`,
    },
    {
      heading: "事实背景",
      body: `我方接受 ${client} 的委托，现就 ${buildPlaceholder("违约或催告事由")} 函告如下：\n\n${buildPlaceholder("事实经过")} ${supplement}`,
    },
    {
      heading: "本所主张",
      body: `请你方立即：\n1. ${buildPlaceholder("核心主张一")}\n2. ${buildPlaceholder("核心主张二")}`,
    },
    {
      heading: "履行期限",
      body: `请你方于收到本函之日起 ${buildPlaceholder("履行期限")} 内完成上述事项。`,
    },
    {
      heading: "法律后果",
      body: `逾期未履行的，我方将依法采取进一步措施，并保留追索违约责任、解除合同及索赔的权利。${buildPlaceholder("其他权利保留")}`,
    },
    {
      heading: "落款",
      body: `${buildPlaceholder("律师事务所名称")}\n经办律师：${buildPlaceholder("律师姓名")}\n日期：${buildPlaceholder("发函日期")}`,
    },
  ];
}

function buildCounselLetterSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const { to, client } = letterAddressSlots(intent.instruction);
  return [
    {
      heading: "收函人",
      body: `致：${to}`,
    },
    {
      heading: "事实背景",
      body: `我方接受 ${client} 的委托，现就 ${buildPlaceholder("争议事项")} 正式函告如下：\n\n${buildPlaceholder("事实经过")} ${supplement}`,
    },
    {
      heading: "请求事项",
      body: `基于双方法律关系及现有证据，请你方：\n1. ${buildPlaceholder("核心请求一")}\n2. ${buildPlaceholder("核心请求二")}`,
    },
    {
      heading: "履行期限",
      body: `请你方于收到本函之日起 ${buildPlaceholder("履行期限")} 内完成上述事项。逾期未履行的，我方将依法采取进一步措施。`,
    },
    {
      heading: "落款",
      body: `${buildPlaceholder("律师事务所名称")}\n经办律师：${buildPlaceholder("律师姓名")}\n日期：${buildPlaceholder("发函日期")}`,
    },
  ];
}

function buildReplyLetterSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  return [
    {
      heading: "来函要点",
      body: `贵方于 ${buildPlaceholder("来函日期")} 来函所涉主要事项：${buildPlaceholder("来函要点")} ${supplement}`,
    },
    {
      heading: "我方立场",
      body: `经核查，我方意见如下：\n1. ${buildPlaceholder("答复意见一")}\n2. ${buildPlaceholder("答复意见二")}`,
    },
    {
      heading: "下一步",
      body: `请贵方于 ${buildPlaceholder("期限")} 内确认上述安排。`,
    },
    {
      heading: "落款",
      body: `${buildPlaceholder("律师事务所名称")}\n经办律师：${buildPlaceholder("律师姓名")}\n日期：${buildPlaceholder("发函日期")}`,
    },
  ];
}

function buildComplaintSections(intent: TaskIntent): ArtifactSection[] {
  const fill = extractComplaintCompileFill(intent.instruction);
  const plan = fill.computed as ComplaintFillPlan;
  const supplement = clarificationTail(intent);
  const stage = formatLitigationStageLine(intent.instruction);
  return [
    {
      heading: "当事人",
      body: `${stage}\n${formatComplaintPartyBlock(plan)}${supplement}`,
    },
    {
      heading: "诉讼请求",
      body: formatComplaintClaimsBlock(plan),
    },
    {
      heading: "事实与理由",
      body: formatComplaintFactsBlock(plan),
    },
    {
      heading: "证据对照",
      body: formatComplaintEvidenceBlock(plan),
    },
    {
      heading: "此致",
      body: formatComplaintClosingBlock(plan),
    },
  ];
}

function buildAnswerSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  return [
    {
      heading: "当事人",
      body: `答辩人：${buildPlaceholder("答辩人名称")}\n被答辩人：${buildPlaceholder("被答辩人名称")}${supplement}`,
    },
    {
      heading: "答辩意见",
      body: `针对诉请逐项答辩：\n1. 对诉讼请求一：${buildPlaceholder("承认/否认/部分承认")}。理由：${buildPlaceholder("对应要件与事实")}\n2. 对诉讼请求二：${buildPlaceholder("承认/否认/部分承认")}。`,
    },
    {
      heading: "事实与理由",
      body: `抗辩要件：${buildPlaceholder("抗辩构成要件")}\n对应事实：${buildPlaceholder("事实")}\n对应证据：${buildPlaceholder("证据或待补充")}`,
    },
  ];
}

function buildBriefSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const chain = formatEvidenceChainBlock(extractEvidenceChain(intent.instruction));
  const stage = formatLitigationStageLine(intent.instruction);
  if (CRIMINAL_INSTRUCTION_RE.test(intent.instruction) || /辩护词/.test(intent.instruction)) {
    return [
      {
        heading: "争点",
        body: `${stage}\n1. ${buildPlaceholder("争点一")}${supplement}`,
      },
      {
        heading: "代理意见",
        body: buildPlaceholder("辩护意见正文"),
      },
      {
        heading: "证据",
        body: chain,
      },
    ];
  }
  return [
    {
      heading: "争点",
      body: `${stage}\n本案主要争点：\n1. ${buildPlaceholder("争点一")}\n2. ${buildPlaceholder("争点二")}${supplement}`,
    },
    {
      heading: "代理意见",
      body: buildPlaceholder("代理意见正文"),
    },
    {
      heading: "证据",
      body: chain,
    },
  ];
}

function buildOpinionMemoSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const elements = extractLegalElements(intent.instruction);
  return [
    {
      heading: "争点",
      body: `需分析的问题：${buildPlaceholder("法律问题")}${supplement}`,
    },
    {
      heading: "要件事实",
      body: formatLegalElementsBody(elements),
    },
    {
      heading: "结论",
      body: buildPlaceholder("简要结论"),
    },
    {
      heading: "依据与引用",
      body: buildPlaceholder("法条/案例/材料引用"),
    },
    {
      heading: "来源边界",
      body: "已核验 / 未核验 / 缺口分栏。材料原文与模型记忆不得当作已核验法条。",
    },
    {
      heading: "保留意见",
      body: `本意见基于现有材料；若事实有变或另有权威文本，结论可能调整。假设：${buildPlaceholder("关键假设")}`,
    },
  ];
}

function buildInternalMemoSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  if (QUICK_TRIAGE_RE.test(intent.instruction)) {
    const elements = extractLegalElements(intent.instruction);
    return [
      {
        heading: "事项",
        body: `${formatQuickTriageBandLine(intent.instruction)}\n${intent.instruction.trim().slice(0, 120)}${supplement}`,
      },
      {
        heading: "结论",
        body: `${buildPlaceholder("能判断的部分")}（先给结论，不要改成表单）`,
      },
      {
        heading: "要件事实",
        body: formatLegalElementsBody(elements),
      },
      {
        heading: "依据",
        body: "能检索则检索。本回合无检索标【待核实】，仍给分析框架。",
      },
      {
        heading: "下一步",
        body: `- ${buildPlaceholder("催告 / 仲裁前置 / 管辖 / 时效")}`,
      },
      {
        heading: "缺口",
        body: `- ${buildPlaceholder("会改变结论的一两项")}`,
      },
    ];
  }
  if (GOVERNANCE_INSTRUCTION_RE.test(intent.instruction)) {
    return buildGovernanceSections(supplement);
  }
  const lpm = inferLpmMemoKind(intent.instruction);
  if (lpm) {
    return buildLpmMemoSections(lpm, supplement);
  }
  return [
    {
      heading: "事项",
      body: `${buildPlaceholder("事项背景")}${supplement}`,
    },
    {
      heading: "结论",
      body: `${buildPlaceholder("内部结论")}（本稿不对客户/对方签发）`,
    },
    {
      heading: "待办",
      body: `- ${buildPlaceholder("下一步待办")}`,
    },
  ];
}

function buildResearchMemoSections(intent: TaskIntent, bundle: ResearchBundle): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const claims = bundle.claims.map((c) => `- ${c.text}`).join("\n");
  const matrix = buildQueryMatrix(intent.instruction);
  const retrieved = bundle.claims.length > 0 || bundle.sources.length > 0;
  return [
    {
      heading: "事项",
      body: `${matrix.issue}${supplement}`,
    },
    {
      heading: "命题矩阵",
      body: formatQueryMatrixBody(matrix, retrieved),
    },
    {
      heading: "现行法条",
      body:
        claims ||
        (retrieved
          ? `名称+条号：${buildPlaceholder("现行有效条文")}。查不到写【待核实】。`
          : formatUnretrievedStatuteBody()),
    },
    {
      heading: "效力层级",
      body: formatNormValidityBody(`${intent.instruction}\n${claims}`),
    },
    {
      heading: "正向类案",
      body: `支持我方的结构事实与案号：${buildPlaceholder("正向类案或待核实")}`,
    },
    {
      heading: "反向类案",
      body: `对方案型 / 需排除：${buildPlaceholder("反向类案或待核实")}`,
    },
    {
      heading: "来源边界",
      body: formatSourceBoundaryBody(bundle),
    },
    {
      heading: "结论",
      body: `${buildPlaceholder("律师版结论")}（本稿不对客户签发，除非另指定意见书）`,
    },
    {
      heading: "缺口",
      body:
        bundle.missingItems.length > 0
          ? bundle.missingItems.map((m) => `- ${m}`).join("\n")
          : `- ${buildPlaceholder("会改变结论的缺口")}`,
    },
  ];
}

function buildLaborCalcSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const compiled = extractLaborCompileFill(intent.instruction);
  const fill = compiled.computed as LaborCalcFill;
  return [
    {
      heading: "定性",
      body: `解除/工时类型：${fill.kind === "2N" ? "违法解除（按 2N 试算）" : fill.kind === "N+1" ? "代通知金（N+1）" : fill.kind === "N" ? "经济补偿（N）" : buildPlaceholder("协商 / 预告 / 过失性 / 违法解除；标准或综合工时")}${supplement}`,
    },
    {
      heading: "仲裁前置",
      body: formatLaborArbitrationBody(fill),
    },
    {
      heading: "计算",
      body: formatLaborCalcBody(fill),
    },
    {
      heading: "结论",
      body: fill.compensation
        ? `已算清：${fill.compensation.amountYuan} 元（${fill.compensation.kind}）。待补：${fill.gaps.length > 0 ? fill.gaps.join("、") : "无"}。`
        : `已算清：${buildPlaceholder("金额")}\n待补流水后才能定：${buildPlaceholder("缺口")}`,
    },
  ];
}

function buildPeriodCalcSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  const compiled = extractPeriodCompileFill(intent.instruction);
  const fill = compiled.computed as PeriodCalcFill;
  return [
    {
      heading: "起算",
      body: `起算事实与日期：${fill.start ?? buildPlaceholder("送达日或知道权利被侵害之日")}${supplement}`,
    },
    {
      heading: "届满日",
      body: formatPeriodCalcBody(fill),
    },
    {
      heading: "缺口",
      body: `中断、中止、节假日顺延：${buildPlaceholder("待核实或不适用")}`,
    },
  ];
}

function buildTimelineSections(intent: TaskIntent): ArtifactSection[] {
  return [
    {
      heading: "时间线",
      body: formatChronologyBody(intent.instruction),
    },
  ];
}

function buildExhibitListSections(intent: TaskIntent): ArtifactSection[] {
  const chain = formatEvidenceChainBlock(extractEvidenceChain(intent.instruction));
  return [
    {
      heading: "证据目录",
      body: chain,
    },
  ];
}

function buildMinutesSections(_intent: TaskIntent): ArtifactSection[] {
  return [
    {
      heading: "出席",
      body: buildPlaceholder("出席人员"),
    },
    {
      heading: "决议",
      body: buildPlaceholder("会议决议"),
    },
    {
      heading: "待办",
      body: `- ${buildPlaceholder("行动项")}（负责人：${buildPlaceholder("负责人")}）`,
    },
  ];
}

function buildNdaSections(intent: TaskIntent): ArtifactSection[] {
  const supplement = clarificationTail(intent);
  return [
    {
      heading: "合同主体",
      body: `甲方：${buildPlaceholder("甲方名称")}\n乙方：${buildPlaceholder("乙方名称")}${supplement}`,
    },
    {
      heading: "保密范围",
      body: `保密信息包括：${buildPlaceholder("保密信息范围")}`,
    },
    {
      heading: "保密期限",
      body: `保密义务期限：${buildPlaceholder("期限")}`,
    },
    {
      heading: "违约责任",
      body: buildPlaceholder("违约责任条款"),
    },
  ];
}

function buildContractReviewSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
): ArtifactSection[] {
  const claimBody =
    bundle.claims.length > 0
      ? bundle.claims.map((c, i) => `${i + 1}. ${c.text}`).join("\n")
      : "当前尚未形成可引用的合同审查意见，请补充合同文本后重试。";
  const riskBody =
    bundle.riskFlags.length > 0
      ? bundle.riskFlags.map((r) => `- ${r}`).join("\n")
      : `- 〔待核实〕${buildPlaceholder("条款位置")}：风险与后果；推荐措辞：${buildPlaceholder("可谈判改法")}`;
  const closed = inferClosedContractType(intent.instruction);
  const paper = inferPaperSide(intent.instruction);
  const role = inferDealRole(intent.instruction, closed.id);
  const paperLine =
    paper === "our_paper"
      ? "己方纸"
      : paper === "their_paper"
        ? "对方纸"
        : "未写明，按对方稿、中立偏委托方";
  const roleLine =
    role === "sell" ? "销售侧" : role === "buy" ? "采购侧" : "未写明，按交易结构审责任上限四个位置";
  const elements = extractLegalElements(intent.instruction);
  const capCompiled = extractLiabilityCapCompileFill(intent.instruction);
  const cap = capCompiled.computed as LiabilityCapFill;
  const capBody = formatLiabilityCapBody(cap);
  const layered = formatLayeredReviewBodies(closed);
  const editLead =
    cap.neverHits.length > 0
      ? `命中永不接受：${cap.neverHits.join("、")}。落地：改这几个字。\n`
      : "";
  return [
    {
      heading: "审查结论",
      body:
        `${formatSignOffLine(bundle)}\n` +
        `${formatClosedContractTypeLine(closed)}\n` +
        (bundle.claims.length > 0
          ? summarizeBundle(bundle)
          : "先按已读文本给出可交付意见；缺事实在待确认事项标明，不要空白暂停。"),
    },
    {
      heading: "纸侧与角色",
      body: `纸侧：${paperLine}。角色：${roleLine}。标准/回退/永不接受见执业口径。`,
    },
    {
      heading: "责任上限",
      body: capBody,
    },
    {
      heading: "要件事实",
      body: formatLegalElementsBody(elements),
    },
    {
      heading: "宏观审查",
      body: layered.macro,
    },
    {
      heading: "中观审查",
      body: layered.meso,
    },
    {
      heading: "微观条款",
      body: claimBody,
    },
    {
      heading: "主要风险",
      body: riskBody,
    },
    {
      heading: "修改建议",
      body: `${editLead}按 P0→P1→P2。每条写：条款锚定、后果、推荐措辞、落地（改哪几个字 / 仅意见）。\n1. 推荐措辞：${buildPlaceholder("可替换原句")}`,
    },
    {
      heading: "改稿计划",
      body: "有钉选合同时：find=最短锚定 → apply_surgical_edits → render_tracked_draft。导出后核 XML。无文件则本栏写「无红线，仅意见」。",
    },
    {
      heading: "效力层级",
      body: formatNormValidityBody(intent.instruction),
    },
    {
      heading: "来源边界",
      body: formatSourceBoundaryBody(bundle),
    },
    {
      heading: "待确认事项",
      body:
        bundle.missingItems.length > 0
          ? bundle.missingItems.map((m) => `- ${m}`).join("\n")
          : `- ${buildPlaceholder("会改变签署结论的缺口")}`,
    },
  ];
}

function buildGeneralSections(bundle: ResearchBundle): ArtifactSection[] {
  const sections: ArtifactSection[] = [
    {
      heading: "检索结论摘要",
      body: summarizeBundle(bundle),
    },
    ...sectionFromClaims(bundle),
  ];

  if (bundle.riskFlags.length > 0) {
    sections.push({
      heading: "风险提示",
      body: bundle.riskFlags.map((r) => `- ${r}`).join("\n"),
    });
  }

  if (bundle.missingItems.length > 0) {
    sections.push({
      heading: "待补充事项",
      body: bundle.missingItems.map((m) => `- ${m}`).join("\n"),
    });
  }

  const conflicts = detectClaimConflicts(bundle);
  if (conflicts.length > 0) {
    sections.push({
      heading: "冲突结论（需律师裁定）",
      body: conflicts.map((c) => `- ${c}`).join("\n"),
    });
  }

  return sections;
}

function buildDeliverableSections(
  intent: TaskIntent,
  bundle: ResearchBundle,
  approvedOutline?: ResearchOutline | null,
): ArtifactSection[] | null {
  if (intent.deliverableType === "ppt.training") {
    return buildTrainingPptSections(intent, bundle, approvedOutline);
  }
  if (!isDeliverableDraftIntent(intent)) {
    return null;
  }
  if (intent.deliverableType === "contract.rental") {
    return buildRentalContractSections(intent);
  }
  if (intent.deliverableType === "contract.general") {
    return buildGeneralContractSections(intent);
  }
  if (intent.deliverableType === "letter.demand") {
    return buildDemandLetterSections(intent);
  }
  if (intent.deliverableType === "letter.counsel") {
    return buildCounselLetterSections(intent);
  }
  if (intent.deliverableType === "letter.reply") {
    return buildReplyLetterSections(intent);
  }
  if (intent.deliverableType === "litigation.complaint") {
    return buildComplaintSections(intent);
  }
  if (intent.deliverableType === "litigation.answer") {
    return buildAnswerSections(intent);
  }
  if (intent.deliverableType === "litigation.brief") {
    return buildBriefSections(intent);
  }
  if (
    intent.deliverableType === "litigation.outline" &&
    FAMILY_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildFamilyMatterSections(clarificationTail(intent));
  }
  if (
    intent.deliverableType === "litigation.outline" &&
    CRIMINAL_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildCriminalMatterSections(clarificationTail(intent));
  }
  if (intent.deliverableType === "memo.opinion") {
    return buildOpinionMemoSections(intent);
  }
  if (intent.deliverableType === "memo.internal") {
    return buildInternalMemoSections(intent);
  }
  if (intent.deliverableType === "memo.research") {
    return buildResearchMemoSections(intent, bundle);
  }
  if (intent.deliverableType === "labor.calc") {
    return buildLaborCalcSections(intent);
  }
  if (intent.deliverableType === "period.calc") {
    return buildPeriodCalcSections(intent);
  }
  if (intent.deliverableType === "matter.timeline") {
    return buildTimelineSections(intent);
  }
  if (intent.deliverableType === "matter.exhibit_list") {
    return buildExhibitListSections(intent);
  }
  if (intent.deliverableType === "meeting.minutes") {
    return buildMinutesSections(intent);
  }
  if (intent.deliverableType === "contract.nda") {
    return buildNdaSections(intent);
  }
  if (intent.deliverableType === "report.esg") {
    return buildEsgReportSections(intent, bundle);
  }
  if (intent.deliverableType === "report.compliance") {
    return buildComplianceReportSections(intent, bundle, approvedOutline);
  }
  if (intent.deliverableType === "report.learning") {
    return buildLearningBriefSections(intent, bundle, approvedOutline);
  }
  if (intent.deliverableType === "report.general") {
    if (ADS_COMPLIANCE_INSTRUCTION_RE.test(intent.instruction)) {
      return buildAdsComplianceSections(clarificationTail(intent));
    }
    if (CAPITAL_INSTRUCTION_RE.test(intent.instruction)) {
      return buildCapitalMarketsSections(clarificationTail(intent));
    }
    return buildGeneralReportSections(intent, bundle);
  }
  if (
    intent.deliverableType === "document.general" &&
    INTAKE_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildMatterIntakeSections(clarificationTail(intent), intent.instruction);
  }
  if (
    intent.deliverableType === "document.general" &&
    BANKRUPTCY_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildBankruptcyMatterSections(clarificationTail(intent));
  }
  if (
    intent.deliverableType === "document.general" &&
    APPEAL_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildAppealSections(clarificationTail(intent), intent.instruction);
  }
  if (
    intent.deliverableType === "document.general" &&
    ENFORCEMENT_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildEnforcementObjectionSections(clarificationTail(intent), intent.instruction);
  }
  if (
    intent.deliverableType === "document.general" &&
    FILING_PACK_INSTRUCTION_RE.test(intent.instruction)
  ) {
    return buildFilingPackSections(clarificationTail(intent), intent.instruction);
  }
  return [
    {
      heading: "正文",
      body: `${buildPlaceholder("请根据任务要求补足正文内容")}${clarificationTail(intent)}`,
    },
    ...sectionFromClaims(bundle),
  ];
}

export function buildDraft(params: BuildDraftParams): ArtifactDraft {
  const { intent, bundle } = params;
  const title = params.title ?? defaultDraftTitle(intent);

  const templateId = params.templateId ?? intent.templateId ?? defaultTemplateId(intent);

  if (intent.deliverableType === "ppt.training") {
    trainingDesenseGateOrThrow({
      workspaceDir: params.workspaceDir,
      intent,
    });
  }

  let sections: ArtifactSection[];
  let clarificationQuestions = intent.clarificationQuestions;
  let draftTitle = title;

  if (isOutlineGatedDeliverable(intent.deliverableType)) {
    const { outline, approved } = resolveOutlineForDraft({
      workspaceDir: params.workspaceDir,
      intent,
      bundle,
    });
    if (!approved) {
      sections = buildOutlineOnlySections(outline);
      draftTitle = `${title}（大纲待确认）`;
      const outlineQ = outlineClarificationQuestion(outline);
      clarificationQuestions = [
        ...(clarificationQuestions ?? []).filter((q) => q.key !== "research_outline_confirm"),
        ...(outlineQ ? [outlineQ] : []),
      ];
    } else {
      clarificationQuestions = clarificationQuestions?.filter(
        (q) => q.key !== "research_outline_confirm",
      );
      if (clarificationQuestions && clarificationQuestions.length === 0) {
        clarificationQuestions = undefined;
      }
      sections =
        buildDeliverableSections(intent, bundle, outline) ??
        (isContractReviewIntent(intent)
          ? buildContractReviewSections(intent, bundle)
          : buildGeneralSections(bundle));
    }
  } else {
    sections =
      buildDeliverableSections(intent, bundle) ??
      (isContractReviewIntent(intent)
        ? buildContractReviewSections(intent, bundle)
        : buildGeneralSections(bundle));
  }

  return {
    taskId: intent.taskId,
    matterId: intent.matterId,
    title: draftTitle,
    output: intent.output === "pptx" ? "pptx" : intent.output === "markdown" ? "markdown" : "docx",
    templateId,
    deliverableType: intent.deliverableType,
    summary: summarizeBundle(bundle),
    audience: intent.audience,
    sections: attachProvenanceToSections(sections, bundle, intent.taskId, intent.deliverableType),
    reviewNotes: [],
    clarificationQuestions,
    acceptanceCriteria: intent.acceptanceCriteria,
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}
