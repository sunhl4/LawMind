export type LawMindGoldenJourneyId =
  | "matter-production-flow"
  | "contract-review-trust-flow"
  | "role-delegation-memory-flow";

export type LawMindGoldenJourneyStep = {
  id: string;
  label: string;
  evidence: string[];
};

export type LawMindGoldenJourney = {
  id: LawMindGoldenJourneyId;
  title: string;
  lawyerOutcome: string;
  acceptanceCriteria: string[];
  requiredSurfaces: string[];
  requiredCommands: string[];
  steps: LawMindGoldenJourneyStep[];
};

export const LAWMIND_Q1_GOLDEN_JOURNEYS: LawMindGoldenJourney[] = [
  {
    id: "matter-production-flow",
    title: "Matter production flow",
    lawyerOutcome: "律师能从案件入口启动工作流，并拿到经过审核门禁的可渲染交付物。",
    requiredSurfaces: ["Matter Cockpit", "Workflow Library", "ReviewWorkbench"],
    requiredCommands: ["pnpm lawmind:quarterly-demo", "pnpm lawmind:desktop:e2e:pr"],
    acceptanceCriteria: [
      "新建 matter 后能选择 workflow/playbook，而不是从空白聊天开始。",
      "deliverable 状态至少覆盖 planned、drafting、pending_review、rendered。",
      "render 前必须展示 acceptance gate，并保留 lawyer approval 证据。",
    ],
    steps: [
      {
        id: "create-matter",
        label: "新建案件并进入 Matter Cockpit",
        evidence: ["workspace/matters/<matterId>/matter.json", "GET /api/matters/detail"],
      },
      {
        id: "run-workflow",
        label: "选择 workflow/playbook 并生成 planned deliverable",
        evidence: ["workspace/lawmind/workflows/*.json", "deliverables/<deliverableId>.json"],
      },
      {
        id: "review-render",
        label: "通过 review gate 后渲染交付物",
        evidence: ["GET /api/drafts/:taskId", "GET /api/drafts/:taskId/acceptance-pack"],
      },
    ],
  },
  {
    id: "contract-review-trust-flow",
    title: "Contract review trust flow",
    lawyerOutcome: "律师能看到合同审查结论的来源、审查矩阵和验收包，而不是只得到一段建议。",
    requiredSurfaces: ["Review Matrix", "Source Preview", "Acceptance Pack"],
    requiredCommands: ["pnpm lawmind:gate", "pnpm lawmind:desktop:e2e:cockpit"],
    acceptanceCriteria: [
      "合同审查草稿必须带 source anchors 或明确列出缺失来源。",
      "审查矩阵可按 matterId 回读，并能映射到 draft acceptance pack。",
      "高风险合同审查必须通过 reasoning gate 或显示 blocker。",
    ],
    steps: [
      {
        id: "ingest-contract",
        label: "读取合同材料并绑定 matter scope",
        evidence: ["read_project_file", "analyze_document", "matterScopeMiddleware"],
      },
      {
        id: "review-matrix",
        label: "生成并展示审查矩阵",
        evidence: ["GET /api/matters/review-matrix", "get_review_matrix MCP tool"],
      },
      {
        id: "acceptance-pack",
        label: "导出带来源和门禁结论的验收包",
        evidence: ["GET /api/drafts/:taskId/acceptance-pack", "audit hash-chain"],
      },
    ],
  },
  {
    id: "role-delegation-memory-flow",
    title: "Role delegation and memory flow",
    lawyerOutcome: "复杂案件能由不同法律岗位协作推进，产出的学习不会直接污染真相源。",
    requiredSurfaces: ["Role Board", "Approval Queue", "Memory Inspector"],
    requiredCommands: ["pnpm lawmind:quarterly-demo", "pnpm test -- src/lawmind"],
    acceptanceCriteria: [
      "delegate_to_role 必须受 role allowlist、risk ceiling 和 approval targetRole 约束。",
      "委派过程要保留 delegation transcript 和 job/progress 状态。",
      "review learning 必须先进入 Memory Adoption 队列，再由律师采纳。",
    ],
    steps: [
      {
        id: "delegate-role",
        label: "将高风险任务委派给合适角色",
        evidence: ["src/lawmind/core/role.ts", "delegate_to_role"],
      },
      {
        id: "approval-queue",
        label: "按角色和风险进入批准队列",
        evidence: ["ApprovalRequest.targetRole", "GET /api/action-summary"],
      },
      {
        id: "memory-adoption",
        label: "复核后的知识进入记忆采纳流程",
        evidence: ["src/lawmind/memory/adoption-service.ts", "Memory Inspector"],
      },
    ],
  },
];

export function listGoldenJourneyIds(): LawMindGoldenJourneyId[] {
  return LAWMIND_Q1_GOLDEN_JOURNEYS.map((journey) => journey.id);
}

export function getGoldenJourney(id: LawMindGoldenJourneyId): LawMindGoldenJourney {
  const journey = LAWMIND_Q1_GOLDEN_JOURNEYS.find((item) => item.id === id);
  if (!journey) {
    throw new Error(`Unknown LawMind golden journey: ${id}`);
  }
  return journey;
}

export function buildGoldenJourneysMarkdown(): string {
  const lines: string[] = [
    "# LawMind Q1 Golden Journeys",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
  ];
  for (const journey of LAWMIND_Q1_GOLDEN_JOURNEYS) {
    lines.push(`## ${journey.title}`, "", journey.lawyerOutcome, "", "Acceptance criteria:");
    for (const criterion of journey.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
    lines.push("", "Required surfaces:", journey.requiredSurfaces.map((x) => `- ${x}`).join("\n"));
    lines.push(
      "",
      "Required commands:",
      journey.requiredCommands.map((x) => `- \`${x}\``).join("\n"),
    );
    lines.push("");
  }
  return lines.join("\n");
}
