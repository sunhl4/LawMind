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
    case "document.general":
      return ["优先输出可直接交付的正式正文。", "若信息不足，先给出可编辑正式草稿并明确待补充项。"];
    default:
      return undefined;
  }
}

function clarificationQuestionsFor(
  type: DeliverableType | undefined,
  instruction: string,
): ClarificationQuestion[] | undefined {
  switch (type) {
    case "contract.rental":
      return buildRentalContractQuestions(instruction);
    case "contract.general":
      return [
        {
          key: "parties_and_subject",
          question:
            "如需精确成稿，请补充合同双方、标的与核心商务条款；若暂时没有，我会先生成带占位符的完整合同草案。",
          reason: "完整合同需要主体与标的明确。",
        },
      ];
    case "letter.demand":
      return [
        {
          key: "claim_deadline",
          question:
            "如需精确成稿，请补充收函对象、核心违约事实和要求履行期限；若暂时没有，我会先生成标准律师函框架。",
          reason: "律师函需要明确对象、主张和期限。",
        },
      ];
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
