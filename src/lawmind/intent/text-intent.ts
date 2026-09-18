/**
 * Text-side intent features. Deterministic; no model.
 *
 * Verbs are the ACTION. Objects / domain words are the FIELD.
 * Joint routing (file genre × verb) is what makes "帮我看看" + 合同.docx
 * a review, and the same words + 起诉状.docx a pleading job.
 */

import { LPM_MEMO_INSTRUCTION_RE } from "../practice/lpm-matter-columns.js";
import {
  ADS_COMPLIANCE_RE,
  APPEAL_RE,
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
  LABOR_CALC_RE,
  LEGAL_EVENT_RE,
  MA_DILIGENCE_RE,
  MATTER_INTAKE_RE,
  PERIOD_CALC_RE,
  QUICK_TRIAGE_RE,
  COMPUTE_TABLE_PACK_RE,
  RESEARCH_FALLBACK_RE,
  TALK_INTAKE_RE,
} from "../skills/capability-patterns.js";
import {
  instructionLooksLikeLetterQa,
  instructionMentionsFolder,
  instructionRejectsContractReview,
  isCorrectionUtterance,
  isContinuationUtterance,
  isLookOnlyUtterance,
  isReadFirstUtterance,
  isTaskSwitchUtterance,
  namedBracketFolders,
  shouldRequireFolderExplore,
  stripRejectedContractReviewPhrases,
} from "./utterance-kind.js";

export type TextVerb =
  | "review"
  | "redline"
  | "draft"
  | "research"
  | "ask"
  | "letter"
  | "continue"
  | "vague";

const GREETING_RE =
  /^(你好|您好|在吗|嗨|哈喽|早上好|下午好|晚上好|hi|hello|hey|你是谁|你是什么模型|你叫什么)[\s?？。.!！]*$/i;

const REVIEW_RE = /审查|审阅|看看|帮我看|帮忙看|看一下|风险|条款问题|意见书|合同审查/;
const REDLINE_RE = /改稿|红线|审阅痕迹|出修订|修订稿|修改这份|改一下|改合同|修改合同/;
const DRAFT_RE = /起草|拟定|拟写|撰写|写一份|拟一份|出一份稿|从零/;
const LETTER_RE = /律师函|催告函|催款函|通知函|回函|答复函|demand letter/;
const CONTINUE_RE =
  /^(继续|接着|再改一下|再改|导出|出稿|打开结果|加上.{0,20}|补充.{0,20}|同样|按这个|好的|嗯|可以)[\s。.!！]*$/;

const CONTRACT_OBJECT_RE = /合同|协议|条款|NDA|保密协议/;
const PLEADING_OBJECT_RE = /起诉状|答辩状|上诉状|代理词|辩护词|诉讼文书|诉请/;

export type TextIntent = {
  greeting: boolean;
  verbs: TextVerb[];
  wantsContract: boolean;
  wantsPleading: boolean;
  wantsLetter: boolean;
  /** True when the lawyer explicitly rejected 合同审核/审查. */
  rejectsContractReview: boolean;
  specialized:
    | "labor"
    | "period"
    | "invoice"
    | "court_sms"
    | "ip"
    | "ma"
    | "data"
    | "ads"
    | "status"
    | "family"
    | "capital"
    | "governance"
    | "civil_stage"
    | "bankruptcy"
    | "criminal"
    | "intake"
    | "talk"
    | "quick"
    | "compute_table"
    | "research"
    | null;
  vague: boolean;
};

function specializedOf(text: string): TextIntent["specialized"] {
  if (LABOR_CALC_RE.test(text)) {
    return "labor";
  }
  if (PERIOD_CALC_RE.test(text)) {
    return "period";
  }
  if (INVOICE_RE.test(text)) {
    return "invoice";
  }
  if (COURT_SMS_RE.test(text) || LEGAL_EVENT_RE.test(text)) {
    return "court_sms";
  }
  if (IP_DISPUTE_RE.test(text)) {
    return "ip";
  }
  if (MA_DILIGENCE_RE.test(text)) {
    return "ma";
  }
  if (DATA_COMPLIANCE_RE.test(text)) {
    return "data";
  }
  if (ADS_COMPLIANCE_RE.test(text)) {
    return "ads";
  }
  if (LPM_MEMO_INSTRUCTION_RE.test(text)) {
    return "status";
  }
  if (FAMILY_MATTER_RE.test(text)) {
    return "family";
  }
  if (CAPITAL_MARKETS_RE.test(text)) {
    return "capital";
  }
  if (GOVERNANCE_RE.test(text)) {
    return "governance";
  }
  if (CIVIL_STAGE_RE.test(text) || APPEAL_RE.test(text)) {
    return "civil_stage";
  }
  if (BANKRUPTCY_RE.test(text)) {
    return "bankruptcy";
  }
  if (CRIMINAL_ROUTE_RE.test(text)) {
    return "criminal";
  }
  if (MATTER_INTAKE_RE.test(text)) {
    return "intake";
  }
  if (TALK_INTAKE_RE.test(text)) {
    return "talk";
  }
  if (COMPUTE_TABLE_PACK_RE.test(text)) {
    return "compute_table";
  }
  if (QUICK_TRIAGE_RE.test(text)) {
    return "quick";
  }
  if (RESEARCH_FALLBACK_RE.test(text)) {
    return "research";
  }
  return null;
}

export function extractTextIntent(instruction: string): TextIntent {
  const text = instruction.trim();
  const greeting = GREETING_RE.test(text);
  const verbs: TextVerb[] = [];
  if (REVIEW_RE.test(text)) {
    verbs.push("review");
  }
  if (REDLINE_RE.test(text)) {
    verbs.push("redline");
  }
  if (DRAFT_RE.test(text)) {
    verbs.push("draft");
  }
  if (RESEARCH_FALLBACK_RE.test(text) && !QUICK_TRIAGE_RE.test(text)) {
    verbs.push("research");
  }
  if (QUICK_TRIAGE_RE.test(text)) {
    verbs.push("ask");
  }
  if (LETTER_RE.test(text)) {
    verbs.push("letter");
  }
  if (CONTINUE_RE.test(text)) {
    verbs.push("continue");
  }
  const specialized = specializedOf(text);
  const vague =
    !greeting && specialized === null && verbs.length === 0 && text.length > 0 && text.length <= 24;
  if (vague || (verbs.length === 0 && !specialized && /看|帮|处理|这个|这份/.test(text))) {
    if (!verbs.includes("vague") && !greeting) {
      verbs.push("vague");
    }
  }
  return {
    greeting,
    verbs: [...new Set(verbs)],
    wantsContract: CONTRACT_OBJECT_RE.test(stripRejectedContractReviewPhrases(text)),
    wantsPleading: PLEADING_OBJECT_RE.test(text),
    wantsLetter: LETTER_RE.test(text),
    rejectsContractReview: instructionRejectsContractReview(text),
    specialized,
    vague: verbs.includes("vague") && !verbs.includes("review") && !verbs.includes("draft"),
  };
}

export {
  instructionLooksLikeLetterQa,
  instructionMentionsFolder,
  instructionRejectsContractReview,
  isContinuationUtterance,
  isCorrectionUtterance,
  isLookOnlyUtterance,
  isReadFirstUtterance,
  isTaskSwitchUtterance,
  namedBracketFolders,
  shouldRequireFolderExplore,
  stripRejectedContractReviewPhrases,
};

export function isGreetingOnly(instruction: string): boolean {
  return GREETING_RE.test(instruction.trim());
}
