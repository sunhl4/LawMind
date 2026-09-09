import { isMailContractFastPathInstruction } from "../platform/mail-contract-short-path-instruction.js";
import { isWordRevisionInstruction } from "../platform/word-revision-instruction.js";
import { LPM_MEMO_INSTRUCTION_RE } from "../practice/lpm-matter-columns.js";
import {
  ADS_COMPLIANCE_RE,
  BANKRUPTCY_RE,
  CAPITAL_MARKETS_RE,
  CIVIL_STAGE_RE,
  COURT_SMS_RE,
  CRIMINAL_ROUTE_RE,
  DATA_COMPLIANCE_RE,
  FAMILY_MATTER_RE,
  GOVERNANCE_RE,
  INVOICE_RE,
  IP_DISPUTE_RE,
  MA_DILIGENCE_RE,
  MATTER_INTAKE_RE,
  PERIOD_CALC_RE,
  QUICK_TRIAGE_RE,
} from "../skills/capability-patterns.js";
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

const EXPLICIT_DELIVERABLE_TYPE_RE =
  /交付物类型代码\s*[:：]\s*(report\.compliance|report\.learning|ppt\.training|report\.esg|report\.general)/i;

const COMPLIANCE_DOSSIER_RE = /(合规卷宗|监管研究|涉外合规|跨境合规|合规备忘录|合规研究)/;

function parseExplicitDeliverableTypeCode(instruction: string): DeliverableType | undefined {
  const m = instruction.match(EXPLICIT_DELIVERABLE_TYPE_RE);
  return m?.[1] ? (m[1].toLowerCase() as DeliverableType) : undefined;
}

function hasComplianceDossierMarkers(instruction: string): boolean {
  return (
    COMPLIANCE_DOSSIER_RE.test(instruction) ||
    (/(合规报告)/.test(instruction) && /(管辖|URL|官网|监管|效力|矩阵)/.test(instruction))
  );
}

/** Preset research types must not be overwritten by keyword heuristics. */
export function isLockedResearchDeliverableType(
  type: DeliverableType | undefined,
): type is "report.compliance" | "report.learning" | "ppt.training" {
  return type === "report.compliance" || type === "report.learning" || type === "ppt.training";
}

function detectDeliverableType(kind: TaskKind, instruction: string): DeliverableType | undefined {
  const explicit = parseExplicitDeliverableTypeCode(instruction);
  if (explicit) {
    return explicit;
  }
  if (isWordRevisionInstruction(instruction)) {
    return "contract.general";
  }
  if (kind === "analyze.contract") {
    return "contract.review";
  }
  if (kind === "draft.ppt") {
    // Keep legacy client-brief path when not clearly a training deck.
    if (/(培训|课件|CLE|讲座|分享会|带教|诊所式|knowledge share)/i.test(instruction)) {
      return "ppt.training";
    }
    return undefined;
  }
  if (kind === "research.legal" || kind === "research.hybrid") {
    if (hasComplianceDossierMarkers(instruction)) {
      return "report.compliance";
    }
    if (MATTER_INTAKE_RE.test(instruction)) {
      return "document.general";
    }
    if (INVOICE_RE.test(instruction)) {
      return "document.general";
    }
    if (COURT_SMS_RE.test(instruction)) {
      return "matter.timeline";
    }
    if (IP_DISPUTE_RE.test(instruction)) {
      return "litigation.outline";
    }
    if (MA_DILIGENCE_RE.test(instruction)) {
      return "report.general";
    }
    if (DATA_COMPLIANCE_RE.test(instruction)) {
      return "report.compliance";
    }
    if (ADS_COMPLIANCE_RE.test(instruction)) {
      return "report.general";
    }
    if (LPM_MEMO_INSTRUCTION_RE.test(instruction)) {
      return "memo.internal";
    }
    if (FAMILY_MATTER_RE.test(instruction)) {
      return "litigation.outline";
    }
    if (CRIMINAL_ROUTE_RE.test(instruction)) {
      return "litigation.outline";
    }
    if (BANKRUPTCY_RE.test(instruction)) {
      return "document.general";
    }
    if (CIVIL_STAGE_RE.test(instruction)) {
      return "document.general";
    }
    if (CAPITAL_MARKETS_RE.test(instruction)) {
      return "report.general";
    }
    if (GOVERNANCE_RE.test(instruction)) {
      return "memo.internal";
    }
    if (QUICK_TRIAGE_RE.test(instruction)) {
      return "memo.internal";
    }
    return "memo.research";
  }
  if (kind !== "draft.word") {
    return undefined;
  }
  if (
    /(计算|核算).{0,16}(经济补偿|赔偿金|加班费|双倍工资|N\s*\+?\s*1|2N)|违法解除.{0,8}(经济补偿|赔偿)/.test(
      instruction,
    )
  ) {
    return "labor.calc";
  }
  if (PERIOD_CALC_RE.test(instruction)) {
    return "period.calc";
  }
  if (/(检索备忘|检索研究备忘|正反类案)/.test(instruction)) {
    return "memo.research";
  }
  if (MATTER_INTAKE_RE.test(instruction)) {
    return "document.general";
  }
  if (INVOICE_RE.test(instruction)) {
    return "document.general";
  }
  if (COURT_SMS_RE.test(instruction)) {
    return "matter.timeline";
  }
  if (IP_DISPUTE_RE.test(instruction)) {
    return "litigation.outline";
  }
  if (MA_DILIGENCE_RE.test(instruction)) {
    return "report.general";
  }
  if (DATA_COMPLIANCE_RE.test(instruction)) {
    return "report.compliance";
  }
  if (ADS_COMPLIANCE_RE.test(instruction)) {
    return "report.general";
  }
  if (LPM_MEMO_INSTRUCTION_RE.test(instruction)) {
    return "memo.internal";
  }
  if (FAMILY_MATTER_RE.test(instruction)) {
    return "litigation.outline";
  }
  if (CRIMINAL_ROUTE_RE.test(instruction)) {
    return "litigation.outline";
  }
  if (BANKRUPTCY_RE.test(instruction)) {
    return "document.general";
  }
  if (CIVIL_STAGE_RE.test(instruction)) {
    return "document.general";
  }
  if (CAPITAL_MARKETS_RE.test(instruction)) {
    return "report.general";
  }
  if (GOVERNANCE_RE.test(instruction)) {
    return "memo.internal";
  }
  if (QUICK_TRIAGE_RE.test(instruction)) {
    return "memo.internal";
  }
  if (/(房屋|住宅|商铺|门面|写字楼|办公室).{0,8}(租赁合同|租房合同)|租赁合同/.test(instruction)) {
    return "contract.rental";
  }
  if (/(回函|答复函|回复函)/.test(instruction) && !/(合同|协议)/.test(instruction)) {
    return "letter.reply";
  }
  if (
    /(催款函|催告函|违约通知|demand letter)/i.test(instruction) ||
    (/(催款|催告)/.test(instruction) && /(函|律师)/.test(instruction))
  ) {
    return "letter.demand";
  }
  if (/(律师函|通知函|告知函)/.test(instruction)) {
    return "letter.counsel";
  }
  if (/(答辩状)/.test(instruction)) {
    return "litigation.answer";
  }
  if (/(代理词|辩护词)/.test(instruction)) {
    return "litigation.brief";
  }
  if (/(起诉状)/.test(instruction) && !/(大纲|提纲)/.test(instruction)) {
    return "litigation.complaint";
  }
  if (
    /(诉讼大纲|诉讼提纲|诉请大纲|立案材料大纲|起诉要点)/.test(instruction) ||
    (/(诉讼|起诉)/.test(instruction) && /(大纲|提纲|要点清单)/.test(instruction))
  ) {
    return "litigation.outline";
  }
  if (/(法律意见书|法律意见)/.test(instruction) && !/(查一下|检索|法条)/.test(instruction)) {
    return "memo.opinion";
  }
  if (
    /(内部备忘|工作备忘)/.test(instruction) ||
    (/(备忘录)/.test(instruction) && !/(合规)/.test(instruction))
  ) {
    return "memo.internal";
  }
  if (/(时间线|大事记)/.test(instruction)) {
    return "matter.timeline";
  }
  if (/(证据目录|证据清单)/.test(instruction)) {
    return "matter.exhibit_list";
  }
  if (/(会议纪要|会议记录)/.test(instruction)) {
    return "meeting.minutes";
  }
  if (/(保密协议|NDA)/i.test(instruction)) {
    return "contract.nda";
  }
  // Compliance dossier before ESG heuristics — EU/NEV +「合规」must not become report.esg.
  if (hasComplianceDossierMarkers(instruction)) {
    return "report.compliance";
  }
  if (/(ESG|可持续发展|环境.?社会.?治理|csr|碳中和|社会责任报告)/i.test(instruction)) {
    return "report.esg";
  }
  if (
    /(欧盟|EU\b|欧洲).{0,48}(新能源汽车|电动车|NEV|纯电动|动力电池|汽车)/i.test(instruction) &&
    /(ESG|可持续|披露|碳中和)/i.test(instruction)
  ) {
    return "report.esg";
  }
  if (/(新能源汽车|电动车|NEV).{0,32}(ESG|可持续|碳中和)/i.test(instruction)) {
    return "report.esg";
  }
  if (
    /(调研简报|学习简报|制度速览|比较法调研|内部分享材料)/.test(instruction) ||
    (/(调研|学习).{0,12}(报告|简报)/.test(instruction) && !/(合同|协议|律师函)/.test(instruction))
  ) {
    return "report.learning";
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
    case "letter.counsel":
      return ["输出完整律师函正文。", "须有收件人、请求、期限与落款。"];
    case "letter.reply":
      return ["输出完整回函正文。", "须回应来函要点并写明我方立场。"];
    case "litigation.complaint":
      return [
        "须有当事人、诉讼请求、要件式事实与证据对照。",
        "用线性栏目，不要 markdown 表冒充要素表。",
      ];
    case "litigation.answer":
      return ["须有答辩要点与事实陈述章节。"];
    case "litigation.brief":
      return ["须有争点与代理意见章节。"];
    case "memo.opinion":
      return ["争点、结论、引用、保留意见均为必要章节。"];
    case "memo.internal":
      return ["须有事项与结论；不得写成可对外签发件。"];
    case "memo.research":
      return ["须含命题、现行法条、正反类案与结论；无命中也保留栏目并标待核实。"];
    case "labor.calc":
      return ["金额必须带来源公式；缺流水标缺口，不得口算假数。"];
    case "period.calc":
      return ["届满日必须有公式；中断顺延标缺口。"];
    case "matter.timeline":
      return ["输出日期—事实对照表。"];
    case "matter.exhibit_list":
      return ["每条证据须有名称与证明目的。"];
    case "meeting.minutes":
      return ["须有决议与待办。"];
    case "contract.nda":
      return ["须有主体、保密范围与期限。"];
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
    case "report.compliance":
      return [
        "输出可复核合规备忘录，包含问题陈述、简要结论、管辖效力矩阵、风险域发现与来源附录。",
        "不确定处标 [VERIFY]；新闻不得写成现行法。",
      ];
    case "report.learning":
      return [
        "输出学习型调研简报，区分效力层级，并给出比较/实务启示。",
        "信息不足时先给出可编辑框架。",
      ];
    case "ppt.training":
      return ["输出可讲解的培训课件结构（短句可讲）。", "使用案件材料前须脱敏或声明已脱敏。"];
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
      if (isWordRevisionInstruction(instruction)) {
        return undefined;
      }
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
    case "litigation.outline": {
      const questions: ClarificationQuestion[] = [];
      if (!hasPartyInfo(instruction)) {
        questions.push({
          key: "parties",
          question: "请补充原被告/当事人名称与诉讼地位。",
          reason: "诉讼大纲须先对齐主体，避免空跑外发。",
        });
      }
      if (!/(诉请|诉讼请求|请求判令|事实|案由)/.test(instruction)) {
        questions.push({
          key: "claims",
          question: "请补充案由、核心事实与主要诉讼请求。",
          reason: "无诉请骨架无法形成可核验大纲。",
        });
      }
      return questions.length > 0 ? questions : undefined;
    }
    case "contract.review": {
      // Mail-contract short path already has baseline path + mail; infer stance/focus — no pause.
      if (
        isMailContractFastPathInstruction(instruction) ||
        isWordRevisionInstruction(instruction)
      ) {
        return undefined;
      }
      const questions: ClarificationQuestion[] = [];
      // Soft Ask only when focus is truly absent — do not use length alone.
      if (!hasReviewFocus(instruction)) {
        questions.push({
          key: "review_focus",
          question:
            "若尚未明确：审查重点（付款、违约、管辖等）与己方立场（甲方/乙方/中立）可补充；有材料时可先推断执行。",
          reason: "有重点可减少返工；材料已钉选时勿空等。",
        });
      }
      if (!/(合同|协议|文本|附件|材料|baseline|cases\/)/.test(instruction)) {
        questions.push({
          key: "review_materials",
          question: "请说明要审查的合同/材料在哪里（已引用文件、案件材料，或粘贴关键条款）。",
          reason: "没有标的文本无法形成可核验审查意见。",
        });
      }
      return questions.length > 0 ? questions : undefined;
    }
    case "report.esg":
    case "report.general":
    case "report.learning": {
      // Skip Soft Ask only when Required Inputs signals are present (not length alone).
      if (/(主题|读者|用途)/.test(instruction) && /(覆盖|框架|章节|指标)/.test(instruction)) {
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
    case "report.compliance": {
      if (/(管辖|URL|官网)/.test(instruction) && /(监管|问题|清单)/.test(instruction)) {
        return undefined;
      }
      return [
        {
          key: "compliance_scope",
          question: "请补充监管问题、涉及管辖区，以及是否已有 URL/官网清单。",
          reason: "合规卷宗需要明确问题边界与来源范围。",
          inputType: "textarea",
        },
      ];
    }
    case "ppt.training": {
      if (/(受众|听众)/.test(instruction) && /(时长|主题)/.test(instruction)) {
        return undefined;
      }
      return [
        {
          key: "training_audience",
          question: "请补充培训主题、受众与预计时长。",
          reason: "受众与时长决定页数与密度。",
        },
      ];
    }
    case "document.general": {
      if (/(用途|读者|对象)/.test(instruction) && /(要点|必须|包含)/.test(instruction)) {
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
  const detected = detectDeliverableType(baseIntent.kind, baseIntent.instruction);
  // Workflow/route preset or locked research type wins over keyword re-guess.
  const deliverableType =
    baseIntent.deliverableType &&
    (isLockedResearchDeliverableType(baseIntent.deliverableType) ||
      baseIntent.deliverableType === "report.esg" ||
      baseIntent.deliverableType === "report.general")
      ? baseIntent.deliverableType
      : detected;
  const baseQuestions = clarificationQuestionsFor(deliverableType, baseIntent.instruction) ?? [];
  // Outline HITL is asked after deep-research / draft gate persists an evidence outline —
  // not at plan time (template-only outlines must not be rubber-stamped).
  return {
    ...baseIntent,
    deliverableType,
    acceptanceCriteria: acceptanceCriteriaFor(deliverableType),
    clarificationQuestions: baseQuestions.length > 0 ? baseQuestions : undefined,
  };
}
