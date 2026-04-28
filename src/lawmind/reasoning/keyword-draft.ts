/**
 * Rule-based reasoning: ResearchBundle -> ArtifactDraft
 */

import type { ArtifactDraft, ArtifactSection, ResearchBundle, TaskIntent } from "../types.js";

export type BuildDraftParams = {
  intent: TaskIntent;
  bundle: ResearchBundle;
  title?: string;
  templateId?: string;
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
  return intent.kind === "draft.word";
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
  if (intent.kind === "draft.ppt") {
    return "LawMind 客户汇报草稿";
  }
  if (intent.deliverableType === "contract.rental") {
    return "房屋租赁合同";
  }
  if (intent.deliverableType === "contract.general") {
    return "合同草案";
  }
  if (intent.deliverableType === "letter.demand") {
    return "律师函";
  }
  if (isContractReviewIntent(intent)) {
    return "合同审查意见书";
  }
  return "LawMind 法律文书草稿";
}

function defaultTemplateId(intent: TaskIntent): string {
  if (intent.output === "pptx") {
    return "ppt/client-brief-default";
  }
  if (intent.deliverableType === "letter.demand") {
    return "word/demand-letter-default";
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
  return [
    {
      heading: "抬头",
      body: `${buildPlaceholder("收函对象")}:`,
    },
    {
      heading: "事实背景",
      body: `我方接受 ${buildPlaceholder("委托人名称")} 的委托，现就 ${buildPlaceholder("争议事项")} 正式函告如下：\n\n${buildPlaceholder("事实经过")} ${supplement}`,
    },
    {
      heading: "我方主张",
      body: `基于双方合同/法律关系及现有证据，你方应立即履行以下义务：\n1. ${buildPlaceholder("核心主张一")}\n2. ${buildPlaceholder("核心主张二")}`,
    },
    {
      heading: "履行期限与法律后果",
      body: `请你方于收到本函之日起 ${buildPlaceholder("履行期限")} 内完成上述义务。逾期未履行的，我方将根据法律规定及委托人授权，采取包括但不限于诉讼、仲裁、财产保全等措施，由此产生的一切不利后果由你方承担。`,
    },
    {
      heading: "落款",
      body: `${buildPlaceholder("律师事务所名称")}\n经办律师：${buildPlaceholder("律师姓名")}\n日期：${buildPlaceholder("发函日期")}`,
    },
  ];
}

function buildContractReviewSections(bundle: ResearchBundle): ArtifactSection[] {
  const sections: ArtifactSection[] = [
    {
      heading: "审查结论",
      body:
        bundle.claims.length > 0
          ? summarizeBundle(bundle)
          : "当前尚未形成可引用的合同审查意见，请补充合同文本或检索来源后重试。",
    },
    ...sectionFromClaims(bundle, (index) => `审查意见 ${index + 1}`),
  ];

  if (bundle.riskFlags.length > 0) {
    sections.push({
      heading: "主要风险提示",
      body: bundle.riskFlags.map((r) => `- ${r}`).join("\n"),
    });
  }

  if (bundle.missingItems.length > 0) {
    sections.push({
      heading: "待确认事项",
      body: bundle.missingItems.map((m) => `- ${m}`).join("\n"),
    });
  }

  const conflicts = detectClaimConflicts(bundle);
  if (conflicts.length > 0) {
    sections.push({
      heading: "冲突意见（需律师裁定）",
      body: conflicts.map((c) => `- ${c}`).join("\n"),
    });
  }

  return sections;
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
): ArtifactSection[] | null {
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

  const sections =
    buildDeliverableSections(intent, bundle) ??
    (isContractReviewIntent(intent)
      ? buildContractReviewSections(bundle)
      : buildGeneralSections(bundle));

  return {
    taskId: intent.taskId,
    matterId: intent.matterId,
    title,
    output: intent.output === "pptx" ? "pptx" : intent.output === "markdown" ? "markdown" : "docx",
    templateId,
    deliverableType: intent.deliverableType,
    summary: summarizeBundle(bundle),
    audience: intent.audience,
    sections,
    reviewNotes: [],
    clarificationQuestions: intent.clarificationQuestions,
    acceptanceCriteria: intent.acceptanceCriteria,
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}
