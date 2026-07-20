import type { ClarificationQuestion, DeliverableType, TaskIntent, TaskKind } from "../types.js";

function hasCurrency(text: string): boolean {
  return /(¥|￥|元|人民币|\d+\s*(元|\/月|每月|万元))/i.test(text);
}

function hasDuration(text: string): boolean {
  return /(\d+\s*(个月|月|年|天)|自.+起至.+止|租期|期限)/.test(text);
}

function hasAddress(text: string): boolean {
  return /(房屋坐落|位于|地址|门牌|室|号楼|小区|街道|路)/.test(text);
}

function hasPartyInfo(text: string): boolean {
  return /(出租人|承租人|甲方|乙方|姓名|名称|身份证|统一社会信用代码)/.test(text);
}

function detectDeliverableType(kind: TaskKind, instruction: string): DeliverableType | undefined {
  if (kind === "analyze.contract") {
    return "contract.review";
  }
  if (kind !== "draft.word") {
    return undefined;
  }
  if (/(房屋|住宅|商铺|门面|写字楼|办公室).{0,8}(租赁合同|租房合同)|租赁合同/.test(instruction)) {
    return "contract.rental";
  }
  if (/(律师函|催款函|通知函|告知函)/.test(instruction)) {
    return "letter.demand";
  }
  if (/(ESG|可持续发展|环境.?社会.?治理|csr|碳中和|社会责任报告)/i.test(instruction)) {
    return "report.esg";
  }
  if (
    /(欧盟|EU\b|欧洲).{0,48}(新能源汽车|电动车|NEV|纯电动|动力电池|汽车)/i.test(instruction) &&
    /(ESG|可持续|报告|披露|合规)/i.test(instruction)
  ) {
    return "report.esg";
  }
  if (/(新能源汽车|电动车|NEV).{0,32}(ESG|可持续|报告)/i.test(instruction)) {
    return "report.esg";
  }
  if (
    /(研究报告|分析报告|年度报告|白皮书|尽职调查报告|合规报告|专项报告)/.test(instruction) &&
    !/(合同|协议|律师函|租赁)/.test(instruction)
  ) {
    return "report.general";
  }
  if (/(合同|协议|补充协议|保密协议|授权书)/.test(instruction)) {
    return "contract.general";
  }
  return "document.general";
}

function buildRentalContractQuestions(instruction: string): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  if (!hasPartyInfo(instruction)) {
    questions.push({
      key: "parties",
      question:
        "请补充出租人和承租人的姓名/名称及身份信息；若暂时没有，我会先用占位符生成正式合同草案。",
      reason: "租赁合同必须明确双方主体。",
    });
  }
  if (!hasAddress(instruction)) {
    questions.push({
      key: "property_address",
      question: "请补充房屋地址、面积和用途；若暂时没有，我会先保留占位符。",
      reason: "租赁标的描述不完整会影响合同可执行性。",
    });
  }
  if (!hasDuration(instruction)) {
    questions.push({
      key: "lease_term",
      question: "请补充租赁期限和起止时间；若暂时没有，我会先生成待补充条款。",
      reason: "租期是租赁合同核心条款。",
    });
  }
  if (!hasCurrency(instruction)) {
    questions.push({
      key: "rent_and_deposit",
      question: "请补充租金、押金和支付周期；若暂时没有，我会先保留标准占位条款。",
      reason: "价款与支付安排是完整交付必需信息。",
    });
  }
  return questions;
}

function acceptanceCriteriaFor(type: DeliverableType | undefined): string[] | undefined {
  switch (type) {
    case "contract.rental":
      return [
        "输出完整合同正文，而不是工作摘要或审查意见。",
        "至少包含主体、房屋信息、租期、租金押金、权利义务、维修费用、违约责任、解除续租、争议解决和签署页。",
        "缺失关键信息时必须以明确占位符或待补充项标识，不能假装已经齐备。",
      ];
    case "contract.general":
      return [
        "输出完整合同草案正文，而不是检索摘要。",
        "至少包含主体、标的、价款/对价、履行方式、违约责任、争议解决和签署条款。",
        "对缺失关键变量使用显式占位符，保持文书可继续编辑。",
      ];
    case "letter.demand":
      return ["输出完整律师函/通知函正文。", "必须包含事实背景、主张、履行期限、法律后果和落款。"];
    case "contract.review":
      return [
        "输出正式审查意见，而不是仅罗列检索点。",
        "至少包含审查结论、主要风险、修改建议和待确认事项。",
      ];
    case "report.esg":
      return [
        "输出 ESG/可持续发展报告正文，覆盖环境、社会、治理等披露维度（按适用框架组织）。",
        "指标与数据宜标注来源；缺失处使用显式占位符。",
      ];
    case "report.general":
      return [
        "输出完整研究报告/专项报告正文。",
        "宜包含背景概述、主体分析与结论建议；信息不足时先给出可编辑框架。",
      ];
    case "document.general":
      return ["优先输出可直接交付的正式正文。", "若信息不足，先给出可编辑正式草稿并明确待补充项。"];
    default:
      return undefined;
  }
}

function hasReviewFocus(text: string): boolean {
  return /(重点|关注|条款|风险|竞业|对赌|违约|管辖|知识产权|付款|交付)/.test(text);
}

function hasLetterTarget(text: string): boolean {
  return /(收函|致函|对方|债务人|违约方|公司|先生|女士|有限)/.test(text);
}

function clarificationQuestionsFor(
  type: DeliverableType | undefined,
  instruction: string,
): ClarificationQuestion[] | undefined {
  switch (type) {
    case "contract.rental":
      return buildRentalContractQuestions(instruction);
    case "contract.general": {
      const questions: ClarificationQuestion[] = [];
      if (!hasPartyInfo(instruction)) {
        questions.push({
          key: "parties_and_subject",
          question: "请补充合同双方名称/主体，以及合同标的（交易内容）。",
          reason: "完整合同需要主体与标的明确。",
        });
      }
      if (!hasCurrency(instruction) && !/(价款|对价|报酬|费用|金额)/.test(instruction)) {
        questions.push({
          key: "commercial_terms",
          question: "请补充核心商务条款（价款/对价、履行方式或期限）；暂缺则用【待补充】占位。",
          reason: "商务条款是可交件合同的关键要素。",
        });
      }
      return questions.length > 0 ? questions : undefined;
    }
    case "letter.demand": {
      const questions: ClarificationQuestion[] = [];
      if (!hasLetterTarget(instruction)) {
        questions.push({
          key: "addressee",
          question: "请补充收函对象（对方名称/身份）。",
          reason: "律师函必须明确收件人。",
        });
      }
      if (!/(事实|违约|拖欠|未履行|主张|要求)/.test(instruction)) {
        questions.push({
          key: "claim_facts",
          question: "请补充核心事实与主张（发生了什么、要求对方做什么）。",
          reason: "主张与事实是函件正文骨架。",
        });
      }
      if (!hasDuration(instruction) && !/(日内|期限|之前|截止)/.test(instruction)) {
        questions.push({
          key: "claim_deadline",
          question: "请补充要求履行的期限（如「收到本函后 N 日内」）。",
          reason: "履行期限影响函件可操作性。",
        });
      }
      return questions.length > 0 ? questions : undefined;
    }
    case "contract.review": {
      const questions: ClarificationQuestion[] = [];
      if (instruction.length < 40 || !hasReviewFocus(instruction)) {
        questions.push({
          key: "review_focus",
          question:
            "请补充审查重点（例如付款、违约、管辖、知识产权、竞业等），以及己方立场（甲方/乙方/中立）。",
          reason: "有重点才能少轮沟通、直接出可审意见。",
        });
      }
      if (!/(合同|协议|文本|附件|材料)/.test(instruction)) {
        questions.push({
          key: "review_materials",
          question: "请说明要审查的合同/材料在哪里（已引用文件、案件材料，或粘贴关键条款）。",
          reason: "没有标的文本无法形成可核验审查意见。",
        });
      }
      return questions.length > 0 ? questions : undefined;
    }
    case "report.esg":
    case "report.general": {
      if (/(主题|读者|用途|覆盖|框架|章节)/.test(instruction) && instruction.length >= 40) {
        return undefined;
      }
      return [
        {
          key: "report_brief",
          question: "请补充报告主题、读者/用途，以及必须覆盖的重点章节或指标。",
          reason: "先对齐口径再起草，可减少返工。",
        },
      ];
    }
    case "document.general": {
      if (instruction.length >= 60) {
        return undefined;
      }
      return [
        {
          key: "doc_purpose",
          question: "请补充文书用途、读者对象，以及必须包含的要点。",
          reason: "用途不清时容易写成无法验收的半成品。",
        },
      ];
    }
    default:
      return undefined;
  }
}

export function enrichIntentWithDeliverableMeta(baseIntent: TaskIntent): TaskIntent {
  const deliverableType = detectDeliverableType(baseIntent.kind, baseIntent.instruction);
  return {
    ...baseIntent,
    deliverableType,
    acceptanceCriteria: acceptanceCriteriaFor(deliverableType),
    clarificationQuestions: clarificationQuestionsFor(deliverableType, baseIntent.instruction),
  };
}
