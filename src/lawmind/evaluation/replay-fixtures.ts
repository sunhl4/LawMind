export type LegalReplayFixture = {
  fixtureId: string;
  matterId: string;
  category:
    | "contract_review"
    | "demand_letter"
    | "client_update"
    | "evidence_index"
    | "matter_chronology"
    | "legal_memo";
  instruction: string;
  expectedDeliverableType: string;
  expectedGateOutcomes: string[];
  requiredSources: string[];
  riskLevel: "low" | "medium" | "high";
};

export const BUILTIN_LEGAL_REPLAY_FIXTURES: LegalReplayFixture[] = [
  {
    fixtureId: "replay-contract-review-msa",
    matterId: "replay-contract-001",
    category: "contract_review",
    instruction: "审查主服务协议中的责任限制、数据安全和终止条款，并输出客户可读风险清单。",
    expectedDeliverableType: "contract-review",
    expectedGateOutcomes: [
      "source_anchors_present",
      "acceptance_pack_ready",
      "reasoning_gate_ready",
    ],
    requiredSources: ["msa.docx", "client-position.md"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-contract-review-nda",
    matterId: "replay-contract-002",
    category: "contract_review",
    instruction: "审查 NDA 中的保密期限、例外披露和违约责任，并给出红线建议。",
    expectedDeliverableType: "contract-review",
    expectedGateOutcomes: ["review_matrix_present", "acceptance_pack_ready"],
    requiredSources: ["nda.docx"],
    riskLevel: "medium",
  },
  {
    fixtureId: "replay-demand-letter-payment",
    matterId: "replay-demand-001",
    category: "demand_letter",
    instruction: "对方逾期支付货款，起草律师函要求 7 日内付款并保留诉讼权利。",
    expectedDeliverableType: "demand-letter",
    expectedGateOutcomes: ["lawyer_approval_required", "reasoning_gate_ready"],
    requiredSources: ["contract.pdf", "invoice.xlsx", "payment-history.csv"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-demand-letter-lease",
    matterId: "replay-demand-002",
    category: "demand_letter",
    instruction: "承租人拖欠租金且擅自转租，起草解除通知和催告函。",
    expectedDeliverableType: "demand-letter",
    expectedGateOutcomes: ["source_anchors_present", "lawyer_approval_required"],
    requiredSources: ["lease.docx", "arrears-ledger.xlsx"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-client-update-litigation",
    matterId: "replay-client-001",
    category: "client_update",
    instruction: "把本周诉讼进展整理为客户可读更新 memo，突出下一步和客户需配合事项。",
    expectedDeliverableType: "client-update-memo",
    expectedGateOutcomes: ["audience_fit_checked", "pending_actions_visible"],
    requiredSources: ["hearing-notes.md", "court-notice.pdf"],
    riskLevel: "medium",
  },
  {
    fixtureId: "replay-client-update-deal",
    matterId: "replay-client-002",
    category: "client_update",
    instruction: "将交易尽调发现整理成客户更新，区分红旗事项和普通待补材料。",
    expectedDeliverableType: "client-update-memo",
    expectedGateOutcomes: ["risk_register_present", "source_anchors_present"],
    requiredSources: ["dd-index.xlsx", "management-q-and-a.md"],
    riskLevel: "medium",
  },
  {
    fixtureId: "replay-evidence-index-labor",
    matterId: "replay-evidence-001",
    category: "evidence_index",
    instruction: "整理劳动争议证据目录，标注证明目的、来源和待补证据。",
    expectedDeliverableType: "evidence-index",
    expectedGateOutcomes: ["missing_sources_listed", "matter_scope_enforced"],
    requiredSources: ["chat-records.pdf", "payroll.xlsx", "termination-letter.docx"],
    riskLevel: "medium",
  },
  {
    fixtureId: "replay-evidence-index-ip",
    matterId: "replay-evidence-002",
    category: "evidence_index",
    instruction: "整理商标侵权证据索引，按侵权事实、损害和主体资格分组。",
    expectedDeliverableType: "evidence-index",
    expectedGateOutcomes: ["source_anchors_present", "risk_register_present"],
    requiredSources: ["screenshots.zip", "sales-records.xlsx", "trademark-cert.pdf"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-matter-chronology-ma",
    matterId: "replay-chronology-001",
    category: "matter_chronology",
    instruction: "根据交易文件和邮件整理关键事实时间线，并标出争议节点。",
    expectedDeliverableType: "matter-chronology",
    expectedGateOutcomes: ["chronology_order_checked", "source_anchors_present"],
    requiredSources: ["email-export.mbox", "term-sheet.pdf", "board-minutes.docx"],
    riskLevel: "medium",
  },
  {
    fixtureId: "replay-matter-chronology-litigation",
    matterId: "replay-chronology-002",
    category: "matter_chronology",
    instruction: "整理诉讼案件从签约到起诉的事实时间线，区分确定事实和待确认事实。",
    expectedDeliverableType: "matter-chronology",
    expectedGateOutcomes: ["missing_sources_listed", "reasoning_gate_ready"],
    requiredSources: ["contract.docx", "notice-history.pdf", "complaint-draft.docx"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-legal-memo-compliance",
    matterId: "replay-memo-001",
    category: "legal_memo",
    instruction: "出具数据跨境合规 memo，说明适用路径、风险和建议动作。",
    expectedDeliverableType: "legal-memo",
    expectedGateOutcomes: ["reasoning_gate_ready", "lawyer_approval_required"],
    requiredSources: ["data-map.xlsx", "policy-summary.md"],
    riskLevel: "high",
  },
  {
    fixtureId: "replay-legal-memo-guarantee",
    matterId: "replay-memo-002",
    category: "legal_memo",
    instruction: "分析担保安排对融资合同执行的影响，并形成内部法律意见。",
    expectedDeliverableType: "legal-memo",
    expectedGateOutcomes: ["issue_coverage_checked", "source_anchors_present"],
    requiredSources: ["facility-agreement.docx", "guarantee.docx"],
    riskLevel: "high",
  },
];

export function listReplayFixtureCategories(): LegalReplayFixture["category"][] {
  return [...new Set(BUILTIN_LEGAL_REPLAY_FIXTURES.map((fixture) => fixture.category))].toSorted();
}
