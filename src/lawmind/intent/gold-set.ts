/**
 * Routing gold set for the intent compiler (P0 measurement).
 * Each row is a lawyer-shaped utterance ± files. Fatal pair:
 * contract.review ↔ litigation.draft must not invert.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import type { LawyerCapabilityId } from "../skills/lawyer-capability-lock.js";
import type { CompileIntentInput } from "./types.js";

export type IntentGoldCase = {
  id: string;
  input: CompileIntentInput;
  expect?: LawyerCapabilityId;
  /** When set, unbound (null bind) is required. */
  unbound?: true;
  pipeline?: "tracked_redline";
};

function pin(relPath: string): ComposeContextPin {
  return { pinKind: "file", root: "project", relPath, kind: "file" };
}

export const INTENT_GOLD_CASES: readonly IntentGoldCase[] = [
  {
    id: "review-nl",
    input: { instruction: "请审查这份采购合同的违约责任" },
    expect: "contract.review",
  },
  { id: "letter-nl", input: { instruction: "写一封催款律师函" }, expect: "letter.draft" },
  { id: "research-nl", input: { instruction: "查一下民法典违约责任" }, expect: "research.memo" },
  { id: "web-fact", input: { instruction: "查一下2026年新说唱总冠军" }, unbound: true },
  { id: "web-fact-bare", input: { instruction: "2026年新说唱总冠军" }, unbound: true },
  {
    id: "mail-short",
    input: {
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\nmatterId=`m1`",
    },
    expect: "mail.contract",
  },
  {
    id: "word-file-page",
    input: {
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
        "修改合同",
      ].join("\n"),
    },
    expect: "contract.review",
    pipeline: "tracked_redline",
  },
  {
    id: "word-export-pin",
    input: {
      instruction: "立场甲方，导出",
      pins: [pin("泰国医疗人工智能战略合作框架协议.docx")],
    },
    expect: "contract.review",
    pipeline: "tracked_redline",
  },
  {
    id: "lock-letter",
    input: {
      instruction: "【办件】能力：letter.draft\n流程：函件起草\n请按已附材料与钉源执行该流程。",
    },
    expect: "letter.draft",
  },
  { id: "hi", input: { instruction: "你好" }, unbound: true },
  { id: "identity", input: { instruction: "你是什么模型" }, unbound: true },
  { id: "draft-lease", input: { instruction: "请起草一份租赁合同" }, expect: "contract.draft" },
  { id: "labor", input: { instruction: "计算违法解除的经济补偿" }, expect: "labor.calc" },
  { id: "period", input: { instruction: "计算上诉期届满日" }, expect: "period.calc" },
  { id: "table", input: { instruction: "把这张表汇总成对照表" }, expect: "materials.draft" },
  { id: "invoice", input: { instruction: "整理这些进项发票" }, expect: "ops.invoice" },
  {
    id: "court-sms",
    input: { instruction: "把法院短信里的开庭时间整理出来" },
    expect: "ops.court_sms",
  },
  { id: "ip", input: { instruction: "这份专利侵权材料怎么主张" }, expect: "ip.dispute" },
  { id: "ma", input: { instruction: "做一份股权收购尽调提纲" }, expect: "deal.ma" },
  {
    id: "data",
    input: { instruction: "出一份数据合规备忘，涉及数据出境" },
    expect: "compliance.data",
  },
  { id: "ads", input: { instruction: "出一份广告合规备忘" }, expect: "compliance.ads" },
  { id: "appeal", input: { instruction: "写上诉状" }, expect: "litigation.draft" },
  { id: "enforcement", input: { instruction: "写一份执行异议" }, expect: "litigation.draft" },
  { id: "filing", input: { instruction: "列立案材料清单" }, expect: "litigation.draft" },
  { id: "issuance", input: { instruction: "写一份待签发清单" }, expect: "matter.status" },
  { id: "collab", input: { instruction: "写事项协作建议" }, expect: "matter.status" },
  { id: "status", input: { instruction: "写本案办案周报" }, expect: "matter.status" },
  { id: "close", input: { instruction: "写一份结案备忘" }, expect: "matter.status" },
  { id: "counsel", input: { instruction: "写一份本地顾问对接" }, expect: "matter.status" },
  { id: "resource", input: { instruction: "写办案人力安排" }, expect: "matter.status" },
  { id: "stakeholder", input: { instruction: "写干系人沟通计划" }, expect: "matter.status" },
  {
    id: "family",
    input: { instruction: "这份离婚诉讼材料怎么主张抚养权" },
    expect: "family.matter",
  },
  {
    id: "capital",
    input: { instruction: "核对招股说明书信息披露备忘" },
    expect: "capital.markets",
  },
  { id: "board", input: { instruction: "起草这份董事会决议" }, expect: "corp.governance" },
  { id: "bankruptcy", input: { instruction: "写一份债权申报" }, expect: "litigation.draft" },
  {
    id: "charter-review",
    input: { instruction: "请审查这份公司章程条款的表决比例" },
    expect: "contract.review",
  },
  { id: "timeline", input: { instruction: "整理案件时间线" }, expect: "chronology.timeline" },
  { id: "intake", input: { instruction: "整理这个案件材料并建立目录" }, expect: "matter.intake" },
  { id: "quick", input: { instruction: "他一直拖欠工资这算不算违法" }, expect: "analysis.quick" },
  { id: "defense", input: { instruction: "写辩护词" }, expect: "litigation.draft" },
  { id: "complaint", input: { instruction: "写起诉状" }, expect: "litigation.draft" },
  { id: "review-short", input: { instruction: "请审查合同条款" }, expect: "contract.review" },

  {
    id: "vague-plus-contract-file",
    input: { instruction: "帮我看看", pins: [pin("买卖合同.docx")] },
    expect: "contract.review",
  },
  {
    id: "look-plus-complaint-file",
    input: { instruction: "看看", pins: [pin("民事起诉状.docx")] },
    expect: "litigation.draft",
  },
  {
    id: "process-plus-letter-file",
    input: { instruction: "处理一下", pins: [pin("催告函.docx")] },
    expect: "letter.draft",
  },
  {
    id: "complaint-peek-quotes-contract",
    input: {
      instruction: "帮我看看这份",
      pins: [pin("材料.docx")],
      documents: [
        {
          relPath: "材料.docx",
          peekText: "民事起诉状\n原告：甲\n被告：乙\n诉讼请求：解除合同并支付违约金。",
        },
      ],
    },
    expect: "litigation.draft",
  },
  {
    id: "review-words-on-complaint",
    input: {
      instruction: "请审查这份采购合同",
      pins: [pin("民事起诉状.docx")],
    },
    expect: "litigation.draft",
  },
  {
    id: "mixed-files-review-contract",
    input: {
      instruction: "请审查这份采购合同",
      pins: [pin("采购合同.docx"), pin("民事起诉状.docx")],
    },
    expect: "contract.review",
  },
  {
    id: "word-revise-complaint",
    input: {
      instruction: "帮我改一下",
      pins: [pin("民事起诉状.docx")],
    },
    expect: "litigation.draft",
    pipeline: "tracked_redline",
  },
  {
    id: "true-contract-review-file",
    input: {
      instruction: "请审查这份采购合同",
      pins: [pin("采购合同.docx")],
    },
    expect: "contract.review",
  },
  {
    id: "labor-beats-contract-file",
    input: {
      instruction: "计算违法解除的经济补偿",
      pins: [pin("劳动合同.docx")],
    },
    expect: "labor.calc",
  },
  {
    id: "invoice-file-only",
    input: { instruction: "整理一下", pins: [pin("进项发票.pdf")] },
    expect: "ops.invoice",
  },
  {
    id: "summons-file",
    input: { instruction: "帮我看看", pins: [pin("开庭传票.pdf")] },
    expect: "ops.court_sms",
  },
  {
    id: "talk-file",
    input: { instruction: "整理", pins: [pin("客户谈话记录.txt")] },
    expect: "litigation.talk",
  },
  {
    id: "privacy-file",
    input: { instruction: "看看这份", pins: [pin("隐私政策.docx")] },
    expect: "compliance.data",
  },
  {
    id: "greeting-plus-contract",
    input: { instruction: "你好", pins: [pin("服务合同.docx")] },
    expect: "contract.review",
  },
  {
    id: "continue-keeps-review",
    input: {
      instruction: "继续",
      previousCapabilityId: "contract.review",
    },
    expect: "contract.review",
  },
  {
    id: "correction-clears-continue",
    input: {
      instruction: "不对",
      previousCapabilityId: "contract.review",
    },
    unbound: true,
  },
  {
    id: "new-intent-beats-continue",
    input: {
      instruction: "写起诉状",
      previousCapabilityId: "contract.review",
    },
    expect: "litigation.draft",
  },
  {
    id: "matter-litigation-vague-evidence",
    input: {
      instruction: "帮我看看",
      matterKind: "litigation",
      pins: [pin("证据清单.pdf")],
    },
    expect: "litigation.draft",
  },
  {
    id: "matter-does-not-override-labor",
    input: {
      instruction: "计算上诉期届满日",
      matterKind: "contract",
    },
    expect: "period.calc",
  },
  {
    id: "review-and-demand-chain",
    input: { instruction: "审查这份合同并写催告函" },
    expect: "contract.review",
  },
  {
    id: "draft-not-review-on-empty-contract-ask",
    input: { instruction: "请拟定一份保密协议" },
    expect: "contract.draft",
  },
];

export const INTENT_GOLD_FATAL_PAIRS: ReadonlyArray<
  readonly [LawyerCapabilityId, LawyerCapabilityId]
> = [["contract.review", "litigation.draft"]];
