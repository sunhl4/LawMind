/**
 * Extra deliverable specs for everyday lawyer text work.
 * Routed from natural language; no new desktop pages.
 */

import { EXPLICIT_TODO_PLACEHOLDER, SCAFFOLD_PLACEHOLDER_PATTERN } from "./placeholder-pattern.js";
import type { DeliverableSpec } from "./types.js";

const PLACEHOLDER_PATTERN = EXPLICIT_TODO_PLACEHOLDER;
const LETTER_FIELD_PLACEHOLDER = {
  pattern: SCAFFOLD_PLACEHOLDER_PATTERN,
  mustResolveBeforeRender: true,
};

const LETTER_SHARED = {
  defaultOutput: "docx" as const,
  defaultRiskLevel: "high" as const,
  placeholderRule: LETTER_FIELD_PLACEHOLDER,
  reasoningGate: {
    required: true as const,
    requiresReasoningGraphAtDraft: true as const,
    minIssues: 2,
    mustResolveAuthorityConflicts: true,
    minFacts: 2,
  },
};

export const LAWYER_WORK_SPECS: readonly DeliverableSpec[] = Object.freeze([
  {
    type: "letter.counsel",
    displayName: "律师函",
    description: "正式律师函正文：收件人、事实、请求、期限、落款。",
    defaultTemplateId: "letter-demand-default",
    ...LETTER_SHARED,
    requiredSections: [
      { headingKeywords: ["收函", "致", "受函人"], purpose: "收件方", severity: "blocker" },
      { headingKeywords: ["事实", "背景"], purpose: "事实背景", severity: "blocker" },
      { headingKeywords: ["主张", "请求", "诉求"], purpose: "请求", severity: "blocker" },
      { headingKeywords: ["期限", "履行"], purpose: "期限", severity: "blocker" },
      { headingKeywords: ["落款", "签发", "律师事务所"], purpose: "落款", severity: "blocker" },
    ],
    acceptanceCriteria: ["输出完整律师函正文。", "须有收件人、请求、期限与落款。"],
    defaultClarificationQuestions: [],
  },
  {
    type: "letter.reply",
    displayName: "回函稿",
    description: "对来函的正式回函：来函要点、我方立场、答复事项、期限。",
    defaultTemplateId: "letter-demand-default",
    ...LETTER_SHARED,
    requiredSections: [
      { headingKeywords: ["来函", "收函", "针对"], purpose: "来函要点", severity: "blocker" },
      { headingKeywords: ["立场", "答复", "意见"], purpose: "答复要点", severity: "blocker" },
      { headingKeywords: ["期限", "下一步"], purpose: "期限或下一步", severity: "warning" },
      { headingKeywords: ["落款", "签发"], purpose: "落款", severity: "blocker" },
    ],
    acceptanceCriteria: ["输出完整回函正文。", "须回应来函要点并写明我方立场。"],
    defaultClarificationQuestions: [],
  },
  {
    type: "litigation.complaint",
    displayName: "起诉状",
    description: "民事起诉状：当事人、事实、诉讼请求、依据。",
    defaultTemplateId: "litigation-outline-default",
    defaultOutput: "docx",
    defaultRiskLevel: "high",
    requiredSections: [
      { headingKeywords: ["原告", "被告", "当事人"], purpose: "当事人", severity: "blocker" },
      { headingKeywords: ["诉讼请求", "请求判令"], purpose: "诉讼请求", severity: "blocker" },
      { headingKeywords: ["事实", "理由"], purpose: "事实与理由", severity: "blocker" },
      { headingKeywords: ["此致", "落款", "具状"], purpose: "落款", severity: "warning" },
    ],
    acceptanceCriteria: ["须有当事人、诉讼请求与事实陈述章节。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "litigation.answer",
    displayName: "答辩状",
    description: "民事答辩状：答辩人、对诉请的答辩意见、事实与理由。",
    defaultTemplateId: "litigation-outline-default",
    defaultOutput: "docx",
    defaultRiskLevel: "high",
    requiredSections: [
      { headingKeywords: ["答辩人", "被答辩", "当事人"], purpose: "当事人", severity: "blocker" },
      { headingKeywords: ["答辩意见", "答辩请求"], purpose: "答辩要点", severity: "blocker" },
      { headingKeywords: ["事实", "理由"], purpose: "事实与理由", severity: "blocker" },
    ],
    acceptanceCriteria: ["须有答辩要点与事实陈述章节。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "litigation.brief",
    displayName: "代理词",
    description: "代理词/辩护词：争点、意见、依据。",
    defaultTemplateId: "litigation-outline-default",
    defaultOutput: "docx",
    defaultRiskLevel: "high",
    requiredSections: [
      { headingKeywords: ["争点", "焦点"], purpose: "争点", severity: "blocker" },
      {
        headingKeywords: ["代理意见", "辩护意见", "意见"],
        purpose: "代理意见",
        severity: "blocker",
      },
      { headingKeywords: ["依据", "法律", "证据"], purpose: "依据", severity: "warning" },
    ],
    acceptanceCriteria: ["须有争点与代理意见章节。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "memo.opinion",
    displayName: "法律意见书",
    description: "对外或可核验的法律意见：争点、结论、引用、保留意见。",
    defaultTemplateId: "word/legal-memo-default",
    defaultOutput: "docx",
    defaultRiskLevel: "high",
    requiredSections: [
      { headingKeywords: ["争点", "问题"], purpose: "争点", severity: "blocker" },
      { headingKeywords: ["结论", "意见"], purpose: "结论", severity: "blocker" },
      { headingKeywords: ["依据", "引用", "法条"], purpose: "引用", severity: "blocker" },
      { headingKeywords: ["保留", "限制", "假设"], purpose: "保留意见", severity: "blocker" },
    ],
    acceptanceCriteria: ["争点、结论、引用、保留意见均为必要章节。"],
    placeholderRule: LETTER_FIELD_PLACEHOLDER,
    defaultClarificationQuestions: [],
  },
  {
    type: "memo.internal",
    displayName: "内部备忘",
    description: "对内备忘：事项、结论、待办。不对外签发。",
    defaultTemplateId: "word/legal-memo-default",
    defaultOutput: "docx",
    defaultRiskLevel: "medium",
    requiredSections: [
      { headingKeywords: ["事项", "背景"], purpose: "事项", severity: "blocker" },
      { headingKeywords: ["结论", "意见"], purpose: "结论", severity: "blocker" },
      { headingKeywords: ["待办", "下一步"], purpose: "待办", severity: "warning" },
    ],
    acceptanceCriteria: ["须有事项与结论；不得写成可对外签发件。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "matter.timeline",
    displayName: "案件时间线",
    description: "按日期排列的事实时间线表。",
    defaultTemplateId: "document-general-default",
    defaultOutput: "docx",
    defaultRiskLevel: "low",
    requiredSections: [
      { headingKeywords: ["时间线", "年表", "日期"], purpose: "时间线表", severity: "blocker" },
    ],
    acceptanceCriteria: ["输出日期—事实对照表，空行不得充数。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "matter.exhibit_list",
    displayName: "证据目录",
    description: "证据目录：编号、名称、证明目的。",
    defaultTemplateId: "document-general-default",
    defaultOutput: "docx",
    defaultRiskLevel: "medium",
    requiredSections: [
      { headingKeywords: ["证据", "目录", "清单"], purpose: "证据目录", severity: "blocker" },
    ],
    acceptanceCriteria: ["每条证据须有名称与证明目的。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "meeting.minutes",
    displayName: "会议纪要",
    description: "会议纪要：出席、决议、待办。写入当前本件草稿。",
    defaultTemplateId: "document-general-default",
    defaultOutput: "docx",
    defaultRiskLevel: "low",
    requiredSections: [
      { headingKeywords: ["出席", "与会"], purpose: "出席", severity: "warning" },
      { headingKeywords: ["决议", "结论", "纪要"], purpose: "决议", severity: "blocker" },
      { headingKeywords: ["待办", "行动", "下一步"], purpose: "待办", severity: "blocker" },
    ],
    acceptanceCriteria: ["须有决议与待办；不升为独立产品页。"],
    placeholderRule: { pattern: PLACEHOLDER_PATTERN, mustResolveBeforeRender: false },
    defaultClarificationQuestions: [],
  },
  {
    type: "contract.nda",
    displayName: "保密协议",
    description: "保密协议：主体、范围、期限、违约。",
    defaultTemplateId: "contract-general-default",
    defaultOutput: "docx",
    defaultRiskLevel: "medium",
    requiredSections: [
      { headingKeywords: ["主体", "甲方", "乙方"], purpose: "主体", severity: "blocker" },
      { headingKeywords: ["保密", "范围", "信息"], purpose: "保密范围", severity: "blocker" },
      { headingKeywords: ["期限"], purpose: "期限", severity: "blocker" },
      { headingKeywords: ["违约"], purpose: "违约", severity: "warning" },
    ],
    acceptanceCriteria: ["须有主体、保密范围与期限。"],
    placeholderRule: LETTER_FIELD_PLACEHOLDER,
    defaultClarificationQuestions: [],
  },
]);
