#!/usr/bin/env node
/**
 * Minimal LawMind local API for Playwright smoke tests (no workspace, no models).
 * Port: LAWMIND_E2E_MOCK_PORT (default 48888).
 */
import http from "node:http";

const PORT = Number(process.env.LAWMIND_E2E_MOCK_PORT || "48888");
const now = new Date().toISOString();
const sessionId = "e2e-session-1";
const defaultModelId = "builtin:qwen-plus";

/** In-memory draft review state for approve → export e2e */
const draftStateById = new Map();
/** sessionId → { planText, updatedAt } */
const planHandoffBySession = new Map();
/** sessionId → chat messages (empty sessions for Solo golden path) */
const sessionMessagesById = new Map();
let sessionCreateSeq = 1;
/** Contract handoff creates real draft ids (not invent-draft to seed-only e2e-draft-1). */
let handoffDraftSeq = 1;
/** Pending-review fleet rows created by chat contract handoff. */
const handoffFleetRuns = [];

/** Client-side `validateDraftAgainstSpec` must be ready, or 在办「一键勾选必核」保持禁用。 */
const E2E_CONTRACT_REVIEW_SECTIONS = [
  { heading: "审查结论", body: "整体可签，风险可控，建议按下列条款微调后签署。" },
  { heading: "主要风险", body: "第 8 条违约金约定偏低，解除条件不够清楚。" },
  { heading: "修改建议", body: "建议提高违约金并写明解除触发条件。" },
  { heading: "待确认事项", body: "管辖法院是否改为上海。" },
];

/**
 * 判断项待定夺的 mock 状态（G3 旁路展示）——**按测试作用域隔离**。
 *
 * 缺省 `empty`：现有各 spec 打开审核台时**不会**多出一张卡（避免污染既有断言）。
 *
 * 为什么按作用域而不是全局单例：这套配置在本地默认 `fullyParallel: true`，
 * 多个 spec **文件**同时跑。共享一份全局状态时，A 文件的 `afterEach` 复位的可能是
 * B 文件刚设好的值 —— 表现为「单独跑绿、全量跑红」的玄学 flake（CI 里
 * `workers: 1` 掩盖了它，所以只有在本机会遇到）。
 *
 * 作用域来自请求头 `x-lawmind-e2e-scope`（由 `installE2eBrowserPrefs` 每个测试
 * 生成一个），缺省 `default` 以保持向后兼容：没带头的调用方仍共用一份状态。
 */
const judgmentMockByScope = new Map();

/** 上下文用量 / 续接的 mock 状态（同样按作用域隔离，理由见 `freshContextBudgetMock`）。 */
const contextBudgetMockByScope = new Map();
const forkMockByScope = new Map();
/** 续接产生的新会话 id → 律师侧「续接来源」卡的数据。 */
const carriedOverFromBySession = new Map();
let forkSeq = 1;

/** 每个作用域的初始状态。新作用域自动拿到它，因此测试之间**零残留**、无需复位。 */
function freshJudgmentMock() {
  return { mode: "empty", posture: "block" };
}

/**
 * 上下文用量 mock（**按作用域**）。
 *
 * 缺省与旧版一致（`ok`、12k/100k、`compactCount: 0`），因此既有 spec 不会多出
 * 「另起新对话」建议卡；只有显式调 `POST /__e2e__/context-budget` 的 spec 才会看到。
 * 分层用量与窗口三元组的形状必须与真实路由一致，否则面板是空壳，断言等于没测。
 */
function freshContextBudgetMock() {
  return {
    used: 12_000,
    effectiveLimit: 100_000,
    level: "ok",
    compactCount: 0,
    lastCompact: null,
  };
}

function contextBudgetMockFor(req) {
  const scope = scopeOf(req);
  let current = contextBudgetMockByScope.get(scope);
  if (!current) {
    current = freshContextBudgetMock();
    contextBudgetMockByScope.set(scope, current);
  }
  return current;
}

/** 续接（fork）的 mock 开关：`ok` 默认；`blocked` 模拟有待批准授权（真实路由应 409）。 */
function freshForkMock() {
  return { mode: "ok" };
}

function forkMockFor(req) {
  const scope = scopeOf(req);
  let current = forkMockByScope.get(scope);
  if (!current) {
    current = freshForkMock();
    forkMockByScope.set(scope, current);
  }
  return current;
}

function scopeOf(req) {
  const raw = req.headers["x-lawmind-e2e-scope"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

function judgmentMockFor(req) {
  const scope = scopeOf(req);
  let current = judgmentMockByScope.get(scope);
  if (!current) {
    current = freshJudgmentMock();
    judgmentMockByScope.set(scope, current);
  }
  return current;
}

/** mock 的待定夺项——文案形状与真实 sidecar 一致（label + reason，**无内部 id**）。 */
const JUDGMENT_ITEMS = [
  { label: "责任上限的水平", reason: "属商业风险分配" },
  { label: "验收标准写多严", reason: "取决于甲方的实际使用场景" },
];

function getDraftState(taskId) {
  const id = String(taskId || "").trim() || "e2e-draft-1";
  if (!draftStateById.has(id)) {
    draftStateById.set(id, {
      reviewStatus: "pending",
      verificationChecklist: null,
      deliverableType: "contract.review",
      deleted: false,
      title: id === "e2e-draft-1" ? "E2E draft" : "合同审查意见",
    });
  }
  return draftStateById.get(id);
}

function createHandoffDraft() {
  const taskId = `e2e-handoff-${handoffDraftSeq++}`;
  getDraftState(taskId);
  handoffFleetRuns.unshift({
    id: `run-handoff-${taskId}`,
    kind: "pending_review",
    status: "awaiting_review",
    title: "合同审查意见（交办）",
    subtitle: "由对话交办登记",
    matterId: "e2e-matter-1",
    assistantId: "default",
    assigneeLabel: "默认助手",
    sessionId,
    taskId,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    priority: 5,
  });
  return taskId;
}

const e2eRequiresAction = [
  {
    id: "ra-tool-1",
    kind: "tool_approval",
    threadId: `${sessionId}:turn`,
    // Non-execute_workflow so chat uses RequiresActionCard（批准并继续 / 改拟稿）not workflow bubble.
    title: "待批准：起草文书",
    summary: "系统准备执行 draft_document，请确认。",
    toolName: "draft_document",
    toolArgs: { workflowId: "e2e-default", title: "E2E 草稿" },
    decisions: ["approve", "reject", "edit"],
    createdAt: now,
  },
];

function seededSignoffMessages() {
  return [
    {
      role: "assistant",
      text: "合同审查意见草稿已就绪，请在「在办」签批后再对外使用。",
      requiresAction: e2eRequiresAction,
      executionState: {
        phase: "approval",
        status: "awaiting_approval",
        linkedTaskId: "e2e-draft-1",
        recoverable: true,
        detail: "等待律师签批。",
      },
    },
  ];
}

function ensureDefaultSessionSeeded() {
  if (!sessionMessagesById.has(sessionId)) {
    sessionMessagesById.set(sessionId, seededSignoffMessages());
  }
}

function isResearchHandoffMessage(msg) {
  const t = String(msg || "");
  return (
    t.includes("合规研究卷宗") ||
    t.includes("学习型调研简报") ||
    t.includes("交付物类型：培训课件") ||
    (t.includes("deep_research") && t.includes("大纲"))
  );
}

function isContractHandoffMessage(msg) {
  const t = String(msg || "");
  if (isResearchHandoffMessage(t)) {
    return false;
  }
  return (
    t.includes("【交办】") ||
    t.includes("5 分钟合同审查") ||
    t.includes("合同/材料说明") ||
    (t.includes("合同审查") && t.includes("审查深度"))
  );
}

function researchOutlineRequiresAction(sid) {
  return [
    {
      id: "ra-outline-1",
      kind: "clarification",
      threadId: `${sid}:turn`,
      title: "待确认：研究大纲",
      summary: "请确认大纲后再撰写正文。",
      clarificationQuestions: [
        {
          key: "research_outline_confirm",
          question:
            "请确认或调整研究大纲\n\n# E2E 研究大纲\n\n## 问题陈述\n- 监管范围\n- 简要结论\n\n## 管辖矩阵\n- 中国内地\n- 相关境外",
          reason: "先确认大纲再写正文",
          inputType: "textarea",
          required: true,
        },
      ],
      decisions: ["respond"],
      createdAt: now,
    },
  ];
}

function contractHandoffAssistantMessage(taskId) {
  return {
    role: "assistant",
    text: "合同审查意见草稿已就绪，请在「在办」签批后再对外使用。",
    status: "awaiting_approval",
    executionState: {
      phase: "approval",
      status: "awaiting_approval",
      linkedTaskId: taskId,
      recoverable: true,
      detail: "等待律师签批。",
    },
    gateDecisions: [
      {
        gate: "approval_gate",
        decision: "awaiting_confirmation",
        reason: "等待律师签批。",
      },
      {
        gate: "acceptance_gate",
        decision: "pass",
        reason: "出稿检查已通过（mock）。",
      },
    ],
  };
}

const assistant = {
  assistantId: "default",
  displayName: "默认助手",
  introduction: "E2E mock",
  presetKey: "general",
  createdAt: now,
  updatedAt: now,
  stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
};

/** 会议室链路需要 ≥2 位参与者。 */
const contractReviewAssistant = {
  assistantId: "contract_review",
  displayName: "合同审查",
  introduction: "E2E mock contract reviewer",
  presetKey: "contract",
  createdAt: now,
  updatedAt: now,
  stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
};
const allAssistants = [assistant, contractReviewAssistant];
const meetingLinesByMatter = new Map();
const createdAutomations = [];
/**
 * 已 resume 的会话 → 律师可见消息（**按作用域隔离**）。
 *
 * 为什么必须是 per-scope：这是一个真实的**跨文件状态泄漏**。本 mock 的其它状态
 * 早就按 `x-lawmind-e2e-scope` 隔离了，只有 resume 这条链没有。旧实现把
 * 「已按您的确认继续处理」写进**全局**的 `sessionMessagesById`，于是
 * `golden-path` 里一次 resume 之后，**同进程里后跑的** `workspace-chat` 打开
 * 同一会话时看到的是「已继续」，而不是种子里的待批准卡 → 断言 `开始对话` /
 * `待批准` 找不到，报错却指向「界面没渲染」。
 *
 * 实测（`--workers=1`，与并行无关）：`automations-deeplink` + `golden-path` +
 * `workspace-chat` 三个文件同跑必红；只跑 `workspace-chat` 则绿。
 *
 * 用 Map<scope, Map<sessionId, messages>>，与 `judgmentMockByScope` /
 * `contextBudgetMockByScope` 同一取向：新作用域自动拿到空覆盖层，
 * 因此 resume 只影响**发起它的那个测试**，其它测试零残留。
 */
const resumedMessagesByScope = new Map();

/** resume 之后该会话应呈现的消息（发起的那个作用域可见）。 */
const RESUMED_CHAT_MESSAGES = [
  { role: "user", text: "请继续完成文书工作。" },
  { role: "assistant", text: "已按您的确认继续处理。" },
];

function resumedMessagesFor(req) {
  const scope = scopeOf(req);
  let current = resumedMessagesByScope.get(scope);
  if (!current) {
    current = new Map();
    resumedMessagesByScope.set(scope, current);
  }
  return current;
}

let meetingLineSeq = 1;

const catalogModel = {
  id: defaultModelId,
  kind: "builtin",
  label: "Qwen Plus",
  description: "E2E mock model",
  group: "E2E",
  provider: "dashscope",
  model: "qwen-plus",
  baseUrl: "http://127.0.0.1",
  configured: true,
  verifiedAt: now,
  verifiedLatencyMs: 12,
};

const authorityCorpusOpenSample = {
  configured: true,
  status: "sample-ready",
  endpointHost: "local-corpus",
  authConfigured: false,
  provider: "open",
  providerLabel: "开源本地语料",
  message: "演示语料就绪：内置 sample（非正式完整法库）。",
  envKey: "LAWMIND_AUTHORITY_ENDPOINT",
  authEnvKey: "LAWMIND_AUTHORITY_API_KEY",
  providerEnvKey: "LAWMIND_AUTHORITY_PROVIDER",
};

const healthPayload = {
  modelConfigured: true,
  modelName: "qwen-plus",
  retrievalMode: "single",
  dualLegalConfigured: false,
  webSearchApiKeyConfigured: false,
  citationMode: "assisted",
  citationModeActive: true,
  triageRulesLoaded: true,
  triageRuleCount: 3,
  authorityCorpus: authorityCorpusOpenSample,
  authorityUsage: {
    day: now.slice(0, 10),
    ok: 0,
    error: 0,
    total: 0,
    message: "今日尚无权威调用。",
  },
  doctor: {
    citationMode: "assisted",
    citationModeActive: true,
    triageRulesLoaded: true,
    triageRuleCount: 3,
    authorityCorpus: authorityCorpusOpenSample,
    authorityUsage: {
      day: now.slice(0, 10),
      ok: 0,
      error: 0,
      total: 0,
      message: "今日尚无权威调用。",
    },
    productMetricsSummary: { total: 3, lawyerConfirmed: 1, gateFailures: 0, firstPassOk: 1 },
    privateDeployChecklist: {
      applicable: false,
      passCount: 3,
      total: 6,
      items: [
        { id: "policy_file", label: "lawmind.policy.json 存在", ok: true },
        { id: "edition_private", label: "edition = private_deploy", ok: false, detail: "firm" },
      ],
    },
  },
};

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
};

const readJsonBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      // `x-lawmind-e2e-scope` 必须在白名单里：它是跨源请求的自定义头，
      // 不在列表里会**触发预检失败**——表现为 page 侧 fetch 全挂
      // （症状是 gotoShell 等健康检查超时，看起来像应用起不来，实际是 CORS）。
      "access-control-allow-headers": "content-type,authorization,x-lawmind-e2e-scope",
    });
    res.end();
    return;
  }

  // Optional Bearer enforcement: set LAWMIND_E2E_MOCK_TOKEN to catch renderer fetch
  // sites that forget apiAuthHeaders() (would 401 in packaged builds). Off by default
  // so the existing suite (renderer sends no token in mock mode) keeps passing.
  const mockToken = process.env.LAWMIND_E2E_MOCK_TOKEN?.trim();
  if (mockToken && path.startsWith("/api/")) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${mockToken}`) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
  }

  if (path === "/api/health" && req.method === "GET") {
    json(res, 200, { ...healthPayload, lawmindDaemon: { enabled: false, running: false } });
    return;
  }

  if (path === "/api/desk/today" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      today: {
        date: now.slice(0, 10),
        items: [
          {
            id: "e2e-carried-plan",
            kind: "plan",
            title: "改代理词",
            done: false,
            originDate: "2020-01-01",
          },
        ],
        progress: { done: 0, total: 1 },
      },
    });
    return;
  }
  if (path === "/api/desk/plan" && req.method === "POST") {
    json(res, 200, {
      ok: true,
      today: {
        date: now.slice(0, 10),
        items: [
          {
            id: "e2e-carried-plan",
            kind: "plan",
            title: "改代理词",
            done: false,
            originDate: "2020-01-01",
          },
        ],
        progress: { done: 0, total: 1 },
      },
    });
    return;
  }
  if (path.startsWith("/api/desk/plan/items/") && req.method === "PATCH") {
    json(res, 200, {
      ok: true,
      today: { date: now.slice(0, 10), items: [], progress: { done: 0, total: 0 } },
    });
    return;
  }
  if (path === "/api/desk/matters" && req.method === "GET") {
    json(res, 200, { ok: true, matters: [] });
    return;
  }

  if (path === "/api/historical-scan" && req.method === "GET") {
    json(res, 200, { ok: true, roots: [], latest: null });
    return;
  }
  if (path === "/api/historical-scan/run" && req.method === "POST") {
    json(res, 200, { ok: true, job: { scanId: "scan-mock", stats: { cataloged: 0 } } });
    return;
  }
  if (path === "/api/historical-scan/roots" && req.method === "POST") {
    json(res, 200, { ok: true, roots: [] });
    return;
  }
  if (path === "/api/historical-scan/roots/remove" && req.method === "POST") {
    json(res, 200, { ok: true, removed: true, roots: [] });
    return;
  }
  if (path === "/api/metrics/north-star" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      schemaVersion: 2,
      firstPassRate: null,
      unattendedCompleteRate: null,
      reviewDurationMsMedian: null,
      lintEscapeRate: null,
      samples: {
        firstPassOk: 0,
        firstPassFail: 0,
        unattended: 0,
        attended: 0,
        lintEscapes: 0,
        deliveries: 0,
      },
    });
    return;
  }

  if (path === "/api/daemon" && req.method === "GET") {
    json(res, 200, { ok: true, daemon: { enabled: false, running: false } });
    return;
  }

  if (path === "/api/daemon" && req.method === "POST") {
    json(res, 200, { ok: true, daemon: { enabled: true, running: false } });
    return;
  }

  if (path === "/api/works/automation" && req.method === "POST") {
    json(res, 201, {
      ok: true,
      automation: {
        id: "auto-from-work-1",
        title: "例行 · 审查供货合同",
        matterId: "matter-acme",
        enabled: true,
      },
    });
    return;
  }

  if (path === "/api/authority/probe" && req.method === "POST") {
    json(res, 200, {
      ok: true,
      probe: { ok: true, latencyMs: 1, hitCount: 5 },
      authorityCorpus: authorityCorpusOpenSample,
      note: "开源语料本地探测通过（非厂商付费库）。",
    });
    return;
  }

  if (path === "/api/metrics/team-growth" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      capturedAt: now,
      windowDays: Number(url.searchParams.get("windowDays") || 30) || 30,
      metrics: [
        {
          id: "first_pass_rate",
          label: "主力一次过率",
          value: 0.62,
          numerator: 31,
          denominator: 50,
          targetNote: "相对基线 ↑ ≥10pt",
          baselineValue: null,
          deltaPts: null,
        },
        {
          id: "rewrite_rate",
          label: "改写率",
          value: 0.38,
          numerator: 19,
          denominator: 50,
          targetNote: "相对基线 ↓",
          baselineValue: null,
          deltaPts: null,
        },
        {
          id: "learning_process_rate",
          label: "学习处理率",
          value: 0.45,
          numerator: 9,
          denominator: 20,
          targetNote: "≥40% 被采纳或驳回",
          baselineValue: null,
          deltaPts: null,
        },
        {
          id: "routing_hit_rate",
          label: "默认路由命中",
          value: 0.7,
          numerator: 7,
          denominator: 10,
          targetNote: "≥60%（有 defaults 且未回退）",
          baselineValue: null,
          deltaPts: null,
        },
        {
          id: "peer_review_coverage",
          label: "互审闸覆盖",
          value: 0.5,
          numerator: 2,
          denominator: 4,
          targetNote: "Firm：触发 / (触发+跳过)",
          baselineValue: null,
          deltaPts: null,
        },
      ],
      assistants: [],
      baseline: null,
    });
    return;
  }

  if (path === "/api/metrics/team-growth/baseline" && req.method === "POST") {
    const body = await readJsonBody(req);
    const windowDays = Number(body?.windowDays || 30) || 30;
    json(res, 200, {
      ok: true,
      capturedAt: now,
      windowDays,
      metrics: [
        {
          id: "first_pass_rate",
          label: "主力一次过率",
          value: 0.62,
          numerator: 31,
          denominator: 50,
          targetNote: "相对基线 ↑ ≥10pt",
          baselineValue: 0.62,
          deltaPts: 0,
        },
      ],
      assistants: [],
      baseline: {
        capturedAt: now,
        note: typeof body?.note === "string" ? body.note : "内测基线",
        windowDays,
      },
      baselineFile: {
        version: 1,
        capturedAt: now,
        windowDays,
        note: typeof body?.note === "string" ? body.note : "内测基线",
        metrics: [{ id: "first_pass_rate", value: 0.62 }],
      },
    });
    return;
  }

  if (path === "/api/policy/edition" && req.method === "GET") {
    // Firm edition keeps multi-assistant features on for e2e (委派 / 按流程办 under「在办」).
    json(res, 200, {
      ok: true,
      edition: "firm",
      label: "律所版",
      source: "default",
      citationMode: "assisted",
      features: {
        acceptanceGateStrict: true,
        citationGateStrict: true,
        crossMatterRoadmap: true,
        crossMatterAcceptanceDashboard: true,
        collaborationSummary: true,
        complianceAuditExport: true,
        auditIntegrityExport: true,
        securitySbomPanel: false,
        qualityDashboardJsonExport: true,
        customDeliverableSpec: true,
        acceptancePackExport: true,
        strictDangerousToolApproval: true,
        reviewCampaignParallel: true,
      },
    });
    return;
  }

  if (path.startsWith("/api/memory/adoption") && req.method === "GET") {
    json(res, 200, { ok: true, items: [], unified: true });
    return;
  }

  if (path === "/api/skills" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      cnPack: {
        id: "cn-legal-pack",
        label: "中国法务自研包",
        workflowIds: ["cn-contract-review", "cn-litigation-elements", "cn-labor-demand"],
        notes: "e2e mock pack",
      },
      skills: [
        {
          id: "cn-contract-checklist",
          name: "合同审查清单",
          version: "1",
          description: "e2e mock skill",
          enabled: true,
          signatureOk: true,
        },
        {
          id: "tampered-skill",
          name: "篡改示例",
          version: "1",
          description: "签名失败不可启用",
          enabled: false,
          signatureOk: false,
          signatureError: "signature_mismatch",
        },
      ],
    });
    return;
  }

  if (path === "/api/skills/enabled" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(res, 200, {
      ok: true,
      skills: [
        {
          id: "cn-contract-checklist",
          name: "合同审查清单",
          version: "1",
          description: "e2e mock skill",
          enabled: body?.skillId === "cn-contract-checklist" ? Boolean(body?.enabled) : true,
          signatureOk: true,
        },
        {
          id: "tampered-skill",
          name: "篡改示例",
          version: "1",
          description: "签名失败不可启用",
          enabled: false,
          signatureOk: false,
          signatureError: "signature_mismatch",
        },
      ],
    });
    return;
  }

  if (path === "/api/triage/rules" && req.method === "GET") {
    json(res, 200, { ok: true, ruleIds: ["nda-yellow", "contract-review-yellow", "litigation-red"] });
    return;
  }

  if (path === "/api/triage" && req.method === "POST") {
    const body = await readJsonBody(req);
    const text = String(body?.text ?? "");
    const isNda = /NDA|保密协议|nondisclosure/i.test(text) || body?.deliverableTypeHint === "contract.nda";
    const session = {
      id: "triage_e2e_mock_1",
      matterId: body?.matterId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "preview",
      inputSummary: text.slice(0, 200),
      deliverableTypeHint: body?.deliverableTypeHint,
      result: isNda
        ? {
            tier: "yellow",
            tierLabel: "需律师确认",
            reasons: ["e2e mock：NDA 分诊"],
            recommendedWorkflowId: "nda-triage",
            recommendedWorkflowLabel: "NDA 分诊剧本",
            estimatedEffort: "medium",
            clarifications: [
              { key: "stance", question: "我方是披露方还是接收方？", required: true },
            ],
            matchedRuleIds: ["nda-yellow"],
          }
        : {
            tier: "yellow",
            tierLabel: "需律师确认",
            reasons: ["e2e mock：合同类分诊"],
            recommendedWorkflowId: "cn-contract-review",
            recommendedWorkflowLabel: "标准合同审查",
            estimatedEffort: "medium",
            clarifications: [{ key: "risk", question: "风险偏好？", required: false }],
            matchedRuleIds: ["contract-review-yellow"],
          },
      dispatchPrompt: body?.dispatchPrompt,
    };
    json(res, 200, {
      ok: true,
      session,
      autoConfirmed: false,
      matchedSkills: isNda
        ? []
        : [{ id: "cn-contract-checklist", name: "合同审查清单", version: "1" }],
    });
    return;
  }

  if (path === "/api/fleet-playbooks" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      playbooks: [
        {
          id: "standard-contract-review",
          label: "标准合同审查专案组",
          version: 1,
          roleCount: 5,
          deliverableTypes: ["contract.review"],
          executionMode: "serial",
        },
      ],
    });
    return;
  }

  const e2eCampaign = {
    id: "campaign_e2e_mock_1",
    matterId: null,
    taskId: "e2e-draft-1",
    playbookId: "standard-contract-review",
    playbookLabel: "标准合同审查专案组",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    roles: [
      { roleId: "clause", label: "条款结构", status: "done", weight: 0.2, score: 80, findings: [] },
      {
        roleId: "risk",
        label: "风险与责任",
        status: "done",
        weight: 0.3,
        score: 55,
        findings: [{ severity: "high", title: "未见责任上限", detail: "e2e" }],
      },
      { roleId: "compliance", label: "合规", status: "done", weight: 0.15, score: 70, findings: [] },
      {
        roleId: "obligation_timeline",
        label: "义务时间线",
        status: "done",
        weight: 0.15,
        score: 75,
        findings: [],
      },
      { roleId: "citation_check", label: "引用核验", status: "done", weight: 0.2, score: 70, findings: [] },
    ],
    safetyScore: {
      score: 68,
      high: 1,
      medium: 0,
      low: 0,
      negotiatePriority: [{ roleId: "risk", title: "未见责任上限", severity: "high", priority: 1 }],
      computedAt: now,
    },
  };

  if (path === "/api/review-campaigns" && req.method === "GET") {
    if (!url.searchParams.get("taskId")) {
      json(res, 400, { ok: false, error: "taskId required" });
      return;
    }
    json(res, 200, { ok: true, campaign: e2eCampaign });
    return;
  }

  if (path === "/api/review-campaigns" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(res, 200, {
      ok: true,
      campaign: {
        ...e2eCampaign,
        matterId: body?.matterId ?? null,
        taskId: body?.taskId ?? e2eCampaign.taskId,
      },
    });
    return;
  }

  if (path === "/api/review-campaigns/campaign_e2e_mock_1/report" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      format: "markdown",
      markdown: "# 审查专案组报告\n\n- Safety Score：68 / 100\n",
      campaignId: "campaign_e2e_mock_1",
    });
    return;
  }

  if (path === "/api/triage/confirm" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(res, 200, {
      ok: true,
      session: {
        id: body?.sessionId ?? "triage_e2e_mock_1",
        matterId: body?.matterId ?? null,
        status: body?.saveOnly ? "saved_only" : "confirmed",
        result: {
          tier: "yellow",
          tierLabel: "需律师确认",
          reasons: ["e2e mock"],
          recommendedWorkflowId: "cn-contract-review",
          recommendedWorkflowLabel: "标准合同审查",
          estimatedEffort: "medium",
          clarifications: [],
          matchedRuleIds: ["contract-review-yellow"],
        },
      },
    });
    return;
  }

  if (path === "/api/tasks" && req.method === "GET") {
    json(res, 200, { ok: true, tasks: [] });
    return;
  }

  if (path === "/api/history" && req.method === "GET") {
    json(res, 200, { ok: true, items: [] });
    return;
  }

  if (path === "/api/assistants" && req.method === "GET") {
    json(res, 200, { ok: true, assistants: allAssistants, presets: [] });
    return;
  }

  if (path === "/api/delegations" && req.method === "GET") {
    json(res, 200, { ok: true, delegations: [], total: 0 });
    return;
  }

  if (path === "/api/collaboration-events" && req.method === "GET") {
    json(res, 200, { ok: true, events: [], total: 0 });
    return;
  }

  if (path === "/api/collaboration/summary" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      collaborationEnabled: true,
      delegationCount: 0,
    });
    return;
  }

  if (path === "/api/collaboration/workflow-templates" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      templates: [
        {
          id: "contract-review",
          name: "合同审查意见",
          description: "生成带章节结构的合同审查意见",
          stepCount: 1,
          practiceArea: "commercial",
          deliverableType: "contract.review",
          riskLevel: "medium",
          starterPrompt: "请审查本案主合同，输出分章节审查意见与风险等级。",
          kind: "matter",
        },
        {
          id: "training-ppt",
          name: "培训 PPT",
          description: "整理成培训课件",
          stepCount: 1,
          practiceArea: "client",
          deliverableType: "ppt.training",
          riskLevel: "low",
          starterPrompt: "请帮我做一份培训 PPT。",
          kind: "office",
        },
      ],
    });
    return;
  }

  if (path === "/api/platform/gate-history" && req.method === "GET") {
    json(res, 200, { ok: true, items: [] });
    return;
  }

  if (path === "/api/matters/overviews" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      overviews: [
        {
          matterId: "e2e-matter-1",
          displayName: "E2E 合同审查案件",
          latestUpdatedAt: now,
          openTaskCount: 1,
          renderedTaskCount: 0,
          riskCount: 0,
          artifactCount: 1,
          topIssue: "待审核草稿",
        },
      ],
    });
    return;
  }

  if (path === "/api/matters/review-matrix" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId") ?? "e2e-matter-1";
    json(res, 200, {
      ok: true,
      matrix: {
        matterId,
        questions: [
          { id: "q-risk", label: "风险与责任", hint: "违约、赔偿" },
        ],
        documents: [
          {
            documentId: "doc-1",
            title: "主服务协议",
            taskId: "e2e-draft-1",
            kind: "draft",
          },
        ],
        cells: [
          {
            documentId: "doc-1",
            questionId: "q-risk",
            excerpt: "违约金条款需律师复核。",
            status: "suggested",
          },
        ],
      },
    });
    return;
  }

  if (path === "/api/matters/session-timeline" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      entries: [
        {
          id: "tl-1",
          at: now,
          kind: "audit",
          title: "草稿进入待审核",
          detail: "出稿检查已计算",
        },
      ],
    });
    return;
  }

  if (path === "/api/matters/create" && req.method === "POST") {
    const body = await readJsonBody(req);
    const matterId =
      typeof body?.matterId === "string" && body.matterId.trim()
        ? body.matterId.trim()
        : "e2e-matter-1";
    json(res, 200, { ok: true, matterId });
    return;
  }

  if (path === "/api/deliverables/specs" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      specs: [
        {
          type: "legal_letter",
          displayName: "律师函",
          description: "E2E starter deliverable",
          defaultOutput: "docx",
          source: "builtin",
        },
      ],
    });
    return;
  }

  if (path === "/api/onboarding/firstrun-wizard" && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  if (path === "/api/acceptance-summary" && req.method === "GET") {
    json(res, 200, { ok: true, items: [], readyCount: 0, blockerCount: 0 });
    return;
  }

  if (path === "/api/templates" && req.method === "GET") {
    json(res, 200, { ok: true, templates: [] });
    return;
  }

  if (path === "/api/learning/suggestions" && req.method === "GET") {
    json(res, 200, { ok: true, suggestions: [] });
    return;
  }

  if (path === "/api/workspace/desk-settings" && req.method === "GET") {
    json(res, 200, { ok: true, contractBatchDir: "" });
    return;
  }

  if (path === "/api/models" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      models: [catalogModel],
      defaultModelId,
      retrievalModelId: null,
      draftWithModelEnabled: false,
      providers: [
        { provider: "dashscope", label: "DashScope", configured: true, envKeys: ["DASHSCOPE_API_KEY"] },
      ],
      platformProviders: [],
      platformMode: "none",
    });
    return;
  }

  if (path === "/api/sessions" && req.method === "GET") {
    ensureDefaultSessionSeeded();
    const sessions = [...sessionMessagesById.keys()].map((id) => ({
      sessionId: id,
      title: id === sessionId ? "New Chat" : "Solo 空会话",
      updatedAt: now,
    }));
    json(res, 200, {
      ok: true,
      sessions: sessions.length > 0 ? sessions : [{ sessionId, title: "New Chat", updatedAt: now }],
    });
    return;
  }

  if (path === "/api/sessions" && req.method === "POST") {
    const id = `e2e-session-empty-${sessionCreateSeq++}`;
    sessionMessagesById.set(id, []);
    json(res, 200, { ok: true, sessionId: id });
    return;
  }

  if (path === "/api/sessions/delete" && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  // E2E-only: 单 mock 服务器跨 spec 共享状态，spec 结束后可调用本路由复位草稿状态。
  if (path === "/__e2e__/reset" && req.method === "POST") {
    draftStateById.clear();
    meetingLinesByMatter.clear();
    createdAutomations.length = 0;
    resumedMessagesByScope.set(scopeOf(req), new Map());
    sessionMessagesById.clear();
    carriedOverFromBySession.clear();
    forkSeq = 1;
    sessionCreateSeq = 1;
    handoffDraftSeq = 1;
    handoffFleetRuns.length = 0;
    // 只复位**调用方自己**的作用域：并行时不该替别的测试清状态。
    judgmentMockByScope.set(scopeOf(req), freshJudgmentMock());
    contextBudgetMockByScope.set(scopeOf(req), freshContextBudgetMock());
    forkMockByScope.set(scopeOf(req), freshForkMock());
    ensureDefaultSessionSeeded();
    json(res, 200, { ok: true });
    return;
  }

  // E2E-only: 判断项待定夺的 mock 开关（缺省空，避免污染其它 spec 的审核台断言）。
  if (path === "/__e2e__/judgment" && req.method === "POST") {
    const body = await readJsonBody(req);
    const mode = String(body?.mode ?? "");
    if (!["items", "empty", "error"].includes(mode)) {
      json(res, 400, { ok: false, error: "bad_mode" });
      return;
    }
    const current = judgmentMockFor(req);
    current.mode = mode;
    current.posture = body?.posture === "advisory" ? "advisory" : "block";
    json(res, 200, { ok: true, ...current });
    return;
  }

  // E2E-only: 上下文用量开关（缺省 ok/12k/100k/compactCount 0 → 不出建议卡）。
  if (path === "/__e2e__/context-budget" && req.method === "POST") {
    const body = await readJsonBody(req);
    const current = contextBudgetMockFor(req);
    if (body?.reset === true) {
      contextBudgetMockByScope.set(scopeOf(req), freshContextBudgetMock());
      json(res, 200, { ok: true, ...contextBudgetMockFor(req) });
      return;
    }
    for (const key of ["used", "effectiveLimit"]) {
      const value = Number(body?.[key]);
      if (Number.isFinite(value) && value >= 0) {
        current[key] = Math.floor(value);
      }
    }
    if (["ok", "warn", "compact"].includes(String(body?.level ?? ""))) {
      current.level = String(body.level);
    }
    const compactCount = Number(body?.compactCount);
    if (Number.isFinite(compactCount) && compactCount >= 0) {
      current.compactCount = Math.floor(compactCount);
    }
    if (body?.midTurn === true) {
      current.lastCompact = {
        at: new Date().toISOString(),
        droppedMessageCount: 18,
        midTurn: true,
      };
    } else if (body?.midTurn === false) {
      current.lastCompact = null;
    }
    json(res, 200, { ok: true, ...current });
    return;
  }

  // E2E-only: 续接阻塞开关（`blocked` → 真实契约是 409 + blockingActions）。
  if (path === "/__e2e__/fork" && req.method === "POST") {
    const body = await readJsonBody(req);
    const mode = String(body?.mode ?? "");
    if (!["ok", "blocked"].includes(mode)) {
      json(res, 400, { ok: false, error: "bad_mode" });
      return;
    }
    const current = forkMockFor(req);
    current.mode = mode;
    json(res, 200, { ok: true, ...current });
    return;
  }

  // ── 判断项明细 / 待定夺（G3）：形状与真实路由一致 ────────────────────────
  if (path === "/api/judgment/task" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId") ?? "";
    if (!taskId) {
      json(res, 400, { ok: false, error: "missing_task_id" });
      return;
    }
    const judgmentMock = judgmentMockFor(req);
    // `error` 模式：返回**不可重试的失败**（404）。
    // 不要用 5xx —— `fetchApi` 会对 5xx 指数退避重试，重试链比断言窗口还长，
    // 「读不到」在界面上会看起来像「没反应」（那是测试假象，不是产品行为）。
    if (judgmentMock.mode === "error") {
      json(res, 404, { ok: false, error: "judgment_unavailable" });
      return;
    }
    json(res, 200, {
      ok: true,
      taskId,
      present: true,
      escalationChannel: "on",
      escalationPosture: judgmentMock.posture,
      coverageNote: "本次机械核对 3 项，其中 2 项由确定性规则判定，1 项需您定夺。通过核对 ≠ 法律正确。",
      counts: { total: 3, machine: 2, judged: 1, decidedByLawyer: 0, notCovered: 0, unavailable: 0 },
      notCovered: [],
      unavailable: [],
      escalation: judgmentMock.mode === "items" ? JUDGMENT_ITEMS : [],
    });
    return;
  }

  if (path === "/api/judgment/escalations" && req.method === "GET") {
    const judgmentMock = judgmentMockFor(req);
    if (judgmentMock.mode === "error") {
      json(res, 404, { ok: false, error: "judgment_unavailable" });
      return;
    }
    const tasks =
      judgmentMock.mode === "items"
        ? [{ taskId: "e2e-draft-1", title: "E2E draft", items: JUDGMENT_ITEMS }]
        : [];
    json(res, 200, {
      ok: true,
      present: tasks.length > 0,
      escalationChannel: "on",
      escalationPosture: judgmentMock.posture,
      tasks,
    });
    return;
  }

  if (path === "/api/judgment/tiering" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      tableSize: 3,
      byTier: { machine: 2, judge: 0, lawyer: 1 },
      byItem: { "pr.deposit": "machine", "pr.pay": "machine", "pr.cap": "lawyer" },
    });
    return;
  }

  const planHandoffMatch = /^\/api\/sessions\/([^/]+)\/plan-handoff$/.exec(path);
  if (planHandoffMatch) {
    const sid = planHandoffMatch[1];
    if (req.method === "GET") {
      json(res, 200, {
        ok: true,
        sessionId: sid,
        planHandoff: planHandoffBySession.get(sid) ?? null,
      });
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      const body = await readJsonBody(req);
      const planText = typeof body?.planText === "string" ? body.planText.trim() : "";
      if (!planText) {
        planHandoffBySession.delete(sid);
        json(res, 200, { ok: true, sessionId: sid, planHandoff: null });
        return;
      }
      const entry = {
        planText: planText.slice(0, 2400),
        updatedAt:
          typeof body?.updatedAt === "string" && body.updatedAt.trim()
            ? body.updatedAt.trim()
            : new Date().toISOString(),
      };
      planHandoffBySession.set(sid, entry);
      json(res, 200, { ok: true, sessionId: sid, planHandoff: entry });
      return;
    }
    if (req.method === "DELETE") {
      planHandoffBySession.delete(sid);
      json(res, 200, { ok: true, sessionId: sid, planHandoff: null });
      return;
    }
  }

  const injectMatch = /^\/api\/sessions\/([^/]+)\/inject$/.exec(path);
  if (injectMatch && req.method === "POST") {
    json(res, 200, { ok: true, sessionId: injectMatch[1], queued: 1, pendingCount: 1 });
    return;
  }

  const steerMatch = /^\/api\/sessions\/([^/]+)\/steer$/.exec(path);
  if (steerMatch && req.method === "POST") {
    json(res, 200, { ok: true, sessionId: steerMatch[1], queued: 1, pendingCount: 1 });
    return;
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch && req.method === "GET") {
    const sid = sessionMatch[1];
    // resume 后的那次重载应呈现「已继续」状态。覆盖层是**按作用域**的：
    // 只在发起 resume 的那个测试里可见，不会把「已继续」写进全局会话库
    // 而污染同进程里后跑的文件（见 `resumedMessagesByScope` 的说明）。
    const resumedMessages = resumedMessagesFor(req).get(sid);
    if (resumedMessages) {
      json(res, 200, { ok: true, messages: resumedMessages });
      return;
    }
    if (sid === sessionId) {
      ensureDefaultSessionSeeded();
    }
    const messages = sessionMessagesById.has(sid)
      ? sessionMessagesById.get(sid)
      : sid === sessionId
        ? seededSignoffMessages()
        : [];
    const carriedOverFrom = carriedOverFromBySession.get(sid);
    json(res, 200, {
      ok: true,
      messages,
      ...(carriedOverFrom ? { carriedOverFrom } : {}),
    });
    return;
  }

  if (path === "/api/drafts" && req.method === "GET") {
    const drafts = [];
    const seen = new Set();
    const pushDraft = (taskId, st) => {
      if (st.deleted || seen.has(taskId)) {
        return;
      }
      seen.add(taskId);
      drafts.push({
        taskId,
        title: st.title || (taskId === "e2e-draft-1" ? "E2E draft" : "合同审查意见"),
        summary: "E2E summary",
        output: "docx",
        templateId: "review-contract-default",
        reviewStatus: st.reviewStatus || "pending",
        matterId: "e2e-matter-1",
        reviewNotes: [],
        sections: E2E_CONTRACT_REVIEW_SECTIONS,
        createdAt: now,
      });
    };
    // Suite specs (redline / trust) rely on stable seed draft; handoff ids are additive.
    pushDraft("e2e-draft-1", getDraftState("e2e-draft-1"));
    for (const [taskId, st] of draftStateById.entries()) {
      pushDraft(taskId, st);
    }
    json(res, 200, { ok: true, drafts });
    return;
  }

  const renderTrackedMatch = /^\/api\/drafts\/([^/]+)\/render-tracked$/.exec(path);
  if (renderTrackedMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      outputPath: `artifacts/${renderTrackedMatch[1]}-tracked.docx`,
      mode: "officecli",
    });
    return;
  }

  const redlineHunkResolveMatch = /^\/api\/drafts\/([^/]+)\/redline\/hunks\/([^/]+)\/resolve$/.exec(
    path,
  );
  if (redlineHunkResolveMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      proposal: {
        taskId: redlineHunkResolveMatch[1],
        baselineSections: [{ heading: "付款", body: "甲方应在十五日内支付全部价款。" }],
        hunks: [
          {
            hunkId: redlineHunkResolveMatch[2],
            sectionIndex: 0,
            sectionHeading: "付款",
            before: "三十",
            after: "十五",
            spanStart: 4,
            spanEnd: 6,
            granularity: "surgical",
            status: "accepted",
          },
        ],
      },
      redlineSummary: { pending: 0, accepted: 1, rejected: 0 },
    });
    return;
  }

  const redlineResolveAllMatch = /^\/api\/drafts\/([^/]+)\/redline\/resolve-all$/.exec(path);
  if (redlineResolveAllMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      resolved: 1,
      proposal: {
        taskId: redlineResolveAllMatch[1],
        baselineSections: [{ heading: "付款", body: "甲方应在十五日内支付全部价款。" }],
        hunks: [],
      },
      redlineSummary: { pending: 0, accepted: 1, rejected: 0 },
    });
    return;
  }

  const redlineMatch = /^\/api\/drafts\/([^/]+)\/redline$/.exec(path);
  if (redlineMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      proposal: {
        taskId: redlineMatch[1],
        baselineSections: [{ heading: "付款", body: "甲方应在三十日内支付全部价款。" }],
        hunks: [
          {
            hunkId: "e2e-hunk-1",
            sectionIndex: 0,
            sectionHeading: "付款",
            before: "三十",
            after: "十五",
            spanStart: 4,
            spanEnd: 6,
            granularity: "surgical",
            status: "pending",
          },
        ],
      },
      redlineSummary: { pending: 1, accepted: 0, rejected: 0 },
    });
    return;
  }

  const draftMatch = /^\/api\/drafts\/([^/]+)$/.exec(path);
  if (draftMatch && req.method === "DELETE") {
    const st = getDraftState(draftMatch[1]);
    if (st.deleted) {
      json(res, 404, { ok: false, error: "not found" });
      return;
    }
    if ((st.reviewStatus || "pending") === "approved") {
      json(res, 409, {
        ok: false,
        error: "draft_not_deletable",
        message: "已签批的交付稿应保留归档；如确需删除，请先恢复待审核。",
        reviewStatus: "approved",
      });
      return;
    }
    st.deleted = true;
    json(res, 200, { ok: true, taskId: draftMatch[1], deletedDraft: true, deletedTask: true });
    return;
  }
  if (draftMatch && req.method === "GET") {
    const st = getDraftState(draftMatch[1]);
    if (st.deleted) {
      json(res, 404, { ok: false, error: "not found" });
      return;
    }
    json(res, 200, {
      ok: true,
      draft: {
        taskId: draftMatch[1],
        title: "E2E draft",
        summary: "E2E summary",
        output: "docx",
        templateId: "review-contract-default",
        deliverableType: st.deliverableType || "contract.review",
        reviewStatus: st.reviewStatus || "pending",
        matterId: "e2e-matter-1",
        reviewNotes: [],
        sections: E2E_CONTRACT_REVIEW_SECTIONS,
        createdAt: now,
        ...(st.verificationChecklist ? { verificationChecklist: st.verificationChecklist } : {}),
      },
      acceptance: {
        // 改稿条看这份报告：未就绪才露出「出稿检查未通过」与核对明细。
        // 在办「一键勾选必核」不读此字段，只对 draft.sections 做客户端 validateDraftAgainstSpec。
        ready: false,
        blockerCount: 1,
        warningCount: 0,
        placeholderCount: 0,
        placeholderSamples: [],
        deliverableType: "contract.review",
        checks: [
          {
            key: "parties",
            label: "当事人信息",
            passed: false,
            severity: "blocker",
            hint: "E2E：出稿检查仍有待补项。",
          },
        ],
      },
      reasoningReport: {
        required: true,
        ready: false,
        blockerCount: 1,
      },
      gateDecisions: [
        {
          gate: "approval_gate",
          decision: "awaiting_confirmation",
          reason: "等待律师签批。",
        },
        {
          gate: "acceptance_gate",
          decision: "block",
          reason: "出稿检查尚有待补项。",
        },
        {
          gate: "reasoning_gate",
          decision: "block",
          reason: "来源锚点待补齐。",
        },
      ],
      executionState: {
        phase: "approval",
        status: "awaiting_approval",
        linkedTaskId: draftMatch[1],
        recoverable: true,
        detail: "等待律师签批。",
      },
    });
    return;
  }

  const reviewMatch = /^\/api\/drafts\/([^/]+)\/review$/.exec(path);
  if (reviewMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      draft: {
        taskId: reviewMatch[1],
        title: "E2E draft",
        summary: "",
        reviewStatus: "pending",
        deliverableType: "contract.review",
        matterId: "e2e-matter-1",
        sections: E2E_CONTRACT_REVIEW_SECTIONS,
      },
      gateDecisions: [
        {
          gate: "approval_gate",
          decision: "awaiting_confirmation",
          reason: "等待律师签批。",
        },
        {
          gate: "acceptance_gate",
          decision: "block",
          reason: "出稿检查尚有待补项。",
        },
      ],
    });
    return;
  }

  if (reviewMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    const st = getDraftState(reviewMatch[1]);
    if (body?.status === "approved") {
      const checked = body?.checklistChecked ?? {};
      const required = ["parties", "liability", "ip", "terminate", "citations"];
      const missing = required.filter((id) => !checked[id]);
      if (missing.length && body?.bypassChecklist !== true) {
        json(res, 422, {
          ok: false,
          error: "checklist_incomplete",
          message: "请完成律师必核清单后再通过签批。",
          missingRequiredIds: missing,
        });
        return;
      }
      st.reviewStatus = "approved";
      st.verificationChecklist = {
        specId: "contract-review-v1",
        checked: { ...Object.fromEntries(required.map((id) => [id, true])), ...checked },
        updatedAt: new Date().toISOString(),
      };
    } else if (body?.status === "rejected" || body?.status === "modified") {
      st.reviewStatus = body.status;
    }
    json(res, 200, {
      ok: true,
      draft: {
        taskId: reviewMatch[1],
        title: "E2E draft",
        reviewStatus: st.reviewStatus,
        deliverableType: "contract.review",
        matterId: "e2e-matter-1",
        sections: E2E_CONTRACT_REVIEW_SECTIONS,
        ...(st.verificationChecklist ? { verificationChecklist: st.verificationChecklist } : {}),
      },
    });
    return;
  }

  const renderMatch = /^\/api\/drafts\/([^/]+)\/render$/.exec(path);
  if (renderMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    if (body?.citationMode === "grounded" || body?.forceGroundedBlock === true) {
      json(res, 422, {
        ok: false,
        error: "theory_not_anchored",
        message: "严格援引模式下案件理论尚未锚定，无法导出。",
      });
      return;
    }
    const st = getDraftState(renderMatch[1]);
    if (st.reviewStatus === "approved") {
      const checked = st.verificationChecklist?.checked ?? {};
      const required = ["parties", "liability", "ip", "terminate", "citations"];
      const missing = required.filter((id) => !checked[id]);
      if (missing.length) {
        json(res, 422, {
          ok: false,
          error: "checklist_incomplete",
          message: "导出被拦截：缺少已落盘的律师必核清单。",
          missingRequiredIds: missing,
        });
        return;
      }
    }
    json(res, 200, { ok: true, outputPath: `artifacts/${renderMatch[1]}.docx` });
    return;
  }

  if (path === "/api/action-summary" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      total: 2,
      requiresDecisionTotal: 1,
      pendingApprovals: 0,
      openQueueItems: 0,
      activeJobs: 0,
      chatRequiresActionCount: 1,
      pendingReviewCount: 1,
      pendingReviewDrafts: [
        {
          taskId: "task-1",
          matterId: "matter-1",
          title: "测试法律意见书",
          reviewStatus: "pending",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      automationInbox: [
        {
          id: "e2e-inbox-send",
          status: "open",
          title: "E2E 待发信",
          summary: "发给对方",
          createdAt: "2026-01-01T00:00:00.000Z",
          matterId: "e2e-matter-1",
          pendingSend: {
            to: "other@example.com",
            subject: "审阅稿",
            body: "请查收",
          },
        },
      ],
      toolApprovals: [],
      approvals: [],
      chatRequiresActions: [],
    });
    return;
  }

  if (path === "/api/approvals" && req.method === "GET") {
    json(res, 200, { ok: true, items: [], decisionTotal: 0 });
    return;
  }

  const approvalDecide = /^\/api\/approvals\/([^/]+)\/(approve|reject)$/.exec(path);
  if (approvalDecide && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  const contextBudgetMatch = /^\/api\/sessions\/([^/]+)\/context-budget$/.exec(path);
  if (contextBudgetMatch && req.method === "GET") {
    const mock = contextBudgetMockFor(req);
    const contextTokens = 128_000;
    const summaryOutputTokenReserve = 20_000;
    const autoCompactBufferTokens = 13_000;
    // 分层用量形状与 `estimateTokenBudgetBreakdown` 一致（{ buckets, total }），
    // 否则面板渲染空壳，e2e 断言等于没测。
    const buckets = [
      { id: "lawyer", tokens: 8_000 },
      { id: "assistant", tokens: 6_000 },
      { id: "toolResults", tokens: 900 },
      { id: "digest", tokens: 1_200 },
      { id: "turnContext", tokens: 300 },
      { id: "pins", tokens: 600 },
      { id: "plan", tokens: 0 },
      { id: "craft", tokens: 0 },
      { id: "workspace", tokens: 500 },
      { id: "rules", tokens: mock.used - 17_500 > 0 ? mock.used - 17_500 : 0 },
    ];
    json(res, 200, {
      ok: true,
      used: mock.used,
      effectiveLimit: mock.effectiveLimit,
      level: mock.level,
      contextTokens,
      maxOutputTokens: 44_800,
      modelId: defaultModelId,
      breakdown: { buckets, total: mock.used },
      window: {
        contextTokens,
        maxOutputTokens: 44_800,
        summaryOutputTokenReserve,
        autoCompactBufferTokens,
        usableLimit: mock.effectiveLimit,
        autoCompactLimit: mock.effectiveLimit,
        midTurnCompactLimit: Math.floor(mock.effectiveLimit * 0.9),
      },
      compactCount: mock.compactCount,
      lastCompact: mock.lastCompact,
    });
    return;
  }

  const sessionAbortMatch = /^\/api\/sessions\/([^/]+)\/abort$/.exec(path);
  if (sessionAbortMatch && req.method === "POST") {
    json(res, 200, { ok: true, aborted: true, sessionId: sessionAbortMatch[1] });
    return;
  }

  const sessionMutateMatch = /^\/api\/sessions\/([^/]+)\/messages\/mutate$/.exec(path);
  if (sessionMutateMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      mode: "truncate",
      removedCount: 0,
      messages: [
        { role: "user", text: "E2E user" },
        { role: "assistant", text: "E2E assistant" },
      ],
    });
    return;
  }

  const sessionForkMatch = /^\/api\/sessions\/([^/]+)\/fork-with-carryover$/.exec(path);
  if (sessionForkMatch && req.method === "POST") {
    const sourceId = sessionForkMatch[1];
    const mock = forkMockFor(req);
    if (mock.mode === "blocked") {
      // 真实契约：待批准授权 → 409 + blockingActions（授权不能跨会话搬）。
      json(res, 409, {
        ok: false,
        code: "pending_authorization",
        message: "当前对话有未处理的批准，须先在原对话处理完再另起新对话。",
        blockingActions: ["tool_approval"],
      });
      return;
    }
    const newId = `e2e-fork-${forkSeq++}`;
    const title = "E2E session（承前）";
    carriedOverFromBySession.set(newId, {
      sessionId: sourceId,
      at: new Date().toISOString(),
      title: "E2E session",
      digestSource: "extractive",
      digestChars: 1_240,
      droppedMessageCount: 18,
      digestPreview: "【压缩前对话蒸馏】摘要：已定位依据并写到解除条款。",
    });
    sessionMessagesById.set(newId, [
      { role: "assistant", text: "已带上上一段对话的整理稿，接着说就行。" },
    ]);
    json(res, 200, {
      ok: true,
      sessionId: newId,
      title,
      reused: false,
      digestSource: "extractive",
      migrated: { matterId: "e2e-matter-1" },
      stats: { droppedMessageCount: 18, digestChars: 1_240, seedChars: 3_600 },
    });
    return;
  }

  const sessionCompactMatch = /^\/api\/sessions\/([^/]+)\/compact$/.exec(path);
  if (sessionCompactMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      compacted: false,
      droppedMessageCount: 0,
      messages: [
        { role: "user", text: "E2E user" },
        { role: "assistant", text: "E2E assistant" },
      ],
      distill: {
        suggestionIds: [],
        sessionSummaryAppended: false,
        preferenceSnippetCount: 0,
      },
    });
    return;
  }

  if (path === "/api/matters/team-roster" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      roster: {
        participantAssistantIds: ["default", "contract_review"],
        synthesizerAssistantId: "contract_review",
      },
    });
    return;
  }

  if (path === "/api/matters/team-roster" && req.method === "PUT") {
    json(res, 200, { ok: true });
    return;
  }

  if (path === "/api/matters/team-meeting" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "120") || 120;
    const all = meetingLinesByMatter.get(matterId) ?? [];
    json(res, 200, { ok: true, lines: all.slice(-limit), total: all.length });
    return;
  }

  if (path === "/api/chat" && req.method === "POST") {
    const body = await readJsonBody(req);
    const msg = typeof body?.message === "string" ? body.message : "";
    if (body?.meetingMode === true) {
      const aid = typeof body?.assistantId === "string" ? body.assistantId : "default";
      const displayName = aid === "contract_review" ? "合同审查" : "默认助手";
      const reply = `【${displayName}发言】围绕本案要点给出本岗意见：条款风险分级、必改项与引用锚定均已覆盖（mock 会议第 ${meetingLineSeq} 轮）。`;
      const matterId = typeof body?.matterId === "string" ? body.matterId : "";
      const kind = body?.meetingTurnKind === "lawyer" ? "user" : "assistant";
      const list = meetingLinesByMatter.get(matterId) ?? [];
      list.push({
        id: `meeting-line-${meetingLineSeq++}`,
        ts: new Date().toISOString(),
        kind,
        text: kind === "user" ? msg : reply,
        assistantId: aid,
        displayName,
        sessionId,
      });
      meetingLinesByMatter.set(matterId, list);
      const payload = {
        ok: true,
        sessionId,
        reply,
        status: "completed",
        requiresAction: [],
      };
      if (msg.includes("e2e-slow")) {
        setTimeout(() => json(res, 200, payload), 1500);
        return;
      }
      json(res, 200, payload);
      return;
    }
    const delayMs = msg.includes("e2e-slow") ? 2500 : 0;
    const sid =
      typeof body?.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : sessionId;
    let payload;
    if (isResearchHandoffMessage(msg)) {
      const outlineActions = researchOutlineRequiresAction(sid);
      payload = {
        ok: true,
        sessionId: sid,
        reply: "已整理研究大纲，请在澄清卡片确认后再撰写正文。",
        status: "needs_clarification",
        requiresAction: outlineActions,
      };
      const prev = sessionMessagesById.get(sid) ?? [];
      sessionMessagesById.set(sid, [
        ...prev,
        { role: "user", text: msg },
        {
          role: "assistant",
          text: payload.reply,
          requiresAction: outlineActions,
          status: "needs_clarification",
        },
      ]);
    } else if (isContractHandoffMessage(msg)) {
      const handoffTaskId = createHandoffDraft();
      const assistantMsg = contractHandoffAssistantMessage(handoffTaskId);
      payload = {
        ok: true,
        sessionId: sid,
        reply: assistantMsg.text,
        status: "awaiting_approval",
        requiresAction: [],
        executionState: assistantMsg.executionState,
        gateDecisions: assistantMsg.gateDecisions,
        linkedTaskId: handoffTaskId,
      };
      const prev = sessionMessagesById.get(sid) ?? [];
      sessionMessagesById.set(sid, [
        ...prev,
        { role: "user", text: msg },
        assistantMsg,
      ]);
    } else {
      payload = {
        ok: true,
        sessionId: sid,
        reply: delayMs > 0 ? "E2E 慢速回复完成。" : "需要您确认后我才能继续执行。",
        requiresAction: delayMs > 0 ? [] : e2eRequiresAction,
      };
    }
    if (msg.includes("e2e-clarify")) {
      payload.reply = "还需要两项信息才能继续。";
      payload.requiresAction = [
        {
          id: "ra-clarify-1",
          kind: "clarification",
          threadId: `${sid}:turn`,
          title: "待澄清：租金与押金",
          summary: "请补充租金金额与押金方式后再起草。",
          clarificationQuestions: [
            { key: "rent", question: "月租金是多少？" },
            { key: "deposit", question: "押金如何约定？" },
          ],
          decisions: ["respond"],
          createdAt: now,
        },
      ];
    }
    if (delayMs > 0) {
      setTimeout(() => json(res, 200, payload), delayMs);
      return;
    }
    json(res, 200, payload);
    return;
  }

  if (path === "/api/chat/resume" && req.method === "POST") {
    const body = await readJsonBody(req);
    resumedMessagesFor(req).set(sessionId, RESUMED_CHAT_MESSAGES);
    json(res, 200, {
      ok: true,
      sessionId,
      reply: "已按您的确认继续处理。",
      requiresAction: [],
      resumeEcho: {
        decision: body?.decision ?? null,
        editedArgs: body?.editedArgs ?? null,
        clarificationAnswers: body?.clarificationAnswers ?? null,
      },
    });
    return;
  }

  if (path === "/api/bootstrap" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      health: healthPayload,
      assistants: allAssistants,
      presets: [],
    });
    return;
  }

  if (path === "/api/agent-fleet" && req.method === "GET") {
    // Seed pending_review for suite specs; handoff runs prepend when chat registered a draft.
    const seedPending = {
      id: "run-pending-review-1",
      kind: "pending_review",
      status: "awaiting_review",
      title: "E2E 待签批草稿",
      subtitle: "合同审查意见",
      matterId: "e2e-matter-1",
      assistantId: "default",
      assigneeLabel: "默认助手",
      sessionId,
      taskId: "e2e-draft-1",
      updatedAt: now,
      createdAt: now,
      priority: 10,
    };
    const seedSend = {
      id: "run-send-1",
      kind: "automation_send",
      status: "awaiting_approval",
      title: "E2E 待发信",
      subtitle: "other@example.com · 审阅稿",
      matterId: "e2e-matter-1",
      assistantId: "default",
      assigneeLabel: "默认助手",
      queueItemId: "e2e-inbox-send",
      toolName: "prepare_outbound_mail",
      updatedAt: now,
      createdAt: now,
      priority: 1,
    };
    const runs = [
      seedSend,
      ...handoffFleetRuns,
      seedPending,
      {
        id: "run-chat-1",
        kind: "chat",
        status: "awaiting_approval",
        title: "E2E 待批准对话",
        matterId: "e2e-matter-1",
        assistantId: "default",
        sessionId,
        actionId: "ra-tool-1",
        toolName: "execute_workflow",
        updatedAt: now,
        createdAt: now,
        priority: 20,
      },
    ];
    const pendingReviewCount = 1 + handoffFleetRuns.length;
    json(res, 200, {
      ok: true,
      runs,
      specialization: {
        default: {
          assistantId: "default",
          roleId: "general_default",
          tasksReviewed: 3,
          firstPassApprovals: 2,
          materialRewrites: 1,
          firstPassRate: 0.67,
          lastUpdatedAt: now,
        },
      },
      growth: {
        windowDays: 30,
        assistants: [
          {
            assistantId: "default",
            roleId: "general_default",
            lifetime: {
              tasksReviewed: 3,
              firstPassApprovals: 2,
              materialRewrites: 1,
              firstPassRate: 0.67,
              rewriteRate: 0.33,
            },
            window: {
              tasksReviewed: 2,
              firstPassApprovals: 1,
              materialRewrites: 1,
              firstPassRate: 0.5,
              rewriteRate: 0.5,
            },
            pendingAdoptions: 1,
          },
        ],
      },
      counts: {
        total: runs.length,
        active: runs.length,
        awaitingAction: runs.length,
        byKind: {
          chat: 1,
          delegation: 0,
          workflow_job: 0,
          queue_item: 0,
          tool_approval: 0,
          matter_approval: 0,
          pending_review: pendingReviewCount,
        },
      },
    });
    return;
  }

  if (path === "/api/agent-presets" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      presets: [
        {
          id: "contract-reviewer",
          title: "合同审查",
          description: "E2E mock preset for contract review",
          roleId: "contract_reviewer",
          deliverableType: "contract.review",
          riskLevel: "high",
          starterPrompt: "请审查本合同并给出意见。",
          sourcePath: "lawmind/agents/contract-reviewer.md",
        },
      ],
    });
    return;
  }

  const fleetTranscriptMatch = /^\/api\/sessions\/([^/]+)\/fleet-transcript$/.exec(path);
  if (fleetTranscriptMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      sessionId: fleetTranscriptMatch[1],
      title: "E2E fleet transcript",
      matterId: "e2e-matter-1",
      assistantId: "default",
      updatedAt: now,
      messages: [
        { role: "user", content: "请审查合同" },
        { role: "assistant", content: "草稿已就绪，请签批。" },
      ],
      pendingRequiresAction: e2eRequiresAction,
    });
    return;
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(path);
  if (taskMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      task: {
        taskId: taskMatch[1],
        title: "E2E 自动办件",
        status: "drafted",
        statusLabel: "已出稿待审",
        matterId: "e2e-matter-1",
        riskLevel: "high",
        deliverableType: "contract.review",
        audience: "client",
        instruction: "审查供应商协议",
        reviewStatus: "pending",
        executionPlan: [
          { id: "s1", label: "检索", status: "done" },
          { id: "s2", label: "起草", status: "done" },
          { id: "s3", label: "签批", status: "pending" },
        ],
        createdAt: now,
        updatedAt: now,
      },
    });
    return;
  }

  // ── Jobs (background workflow jobs) ─────────────────────────────────────────
  if (path === "/api/automations/presets" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      presets: [
        {
          id: "mail-contract-review",
          title: "邮件合同审阅",
          description: "定时同步邮箱并把合同附件做最小改稿审阅",
          needsMail: true,
          defaultSchedule: { kind: "interval", everyMinutes: 30 },
          defaultAllowSend: false,
          templateId: "mail-contract-redline",
        },
        {
          id: "renewal-monitor",
          title: "续签监控",
          description: "扫描合同到期日与续签条款",
          needsMail: false,
          defaultSchedule: { kind: "daily", hour: 8, minute: 30 },
          defaultAllowSend: false,
        },
        {
          id: "custom",
          title: "自定义交办",
          description: "按自然语言指令定时执行",
          needsMail: false,
          defaultSchedule: { kind: "daily", hour: 9, minute: 0 },
          defaultAllowSend: false,
        },
      ],
    });
    return;
  }

  if (path === "/api/automations" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      automations: createdAutomations,
      inbox: [
        {
          id: "inb-e2e-1",
          automationId: "auto-e2e-1",
          matterId: "e2e-matter-1",
          title: "邮件合同审阅 · 运行结果",
          summary: "已按基线完成最小改稿并生成审阅稿（cases/e2e-matter-1/合同_2026-08-02.docx）。",
          status: "open",
          jobId: "e2e-wf-run",
          createdAt: now,
        },
      ],
    });
    return;
  }

  if (path === "/api/automations" && req.method === "POST") {
    const body = await readJsonBody(req);
    const presetTitles = {
      "mail-contract-review": "邮件合同审阅",
      "renewal-monitor": "续签监控",
    };
    const automation = {
      id: `auto-${createdAutomations.length + 1}`,
      title: body?.title ?? presetTitles[body?.presetId] ?? "自定义交办",
      enabled: true,
      presetId: body?.presetId ?? "custom",
      matterId: body?.matterId ?? "e2e-matter-1",
      instruction: body?.instruction,
      schedule: body?.schedule ?? { kind: "daily", hour: 9, minute: 0 },
      nextRunAt: now,
      allowSendEmailAfterApproval: body?.allowSendEmailAfterApproval !== false,
      createdAt: now,
      updatedAt: now,
    };
    createdAutomations.push(automation);
    json(res, 201, { ok: true, automation });
    return;
  }

  if (path === "/api/jobs" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      jobs: [
        {
          jobId: "e2e-wf-run",
          status: "running",
          workflowId: "mail-contract-redline",
          matterId: "e2e-matter-1",
          createdAt: now,
          progress: { totalSteps: 2, completedSteps: 1, failedSteps: 0, runningStepIds: ["s2"] },
        },
      ],
    });
    return;
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(path);
  if (jobMatch && req.method === "GET") {
    const isRun = jobMatch[1] === "e2e-wf-run";
    json(res, 200, {
      ok: true,
      job: isRun
        ? {
            jobId: "e2e-wf-run",
            status: "running",
            workflowId: "mail-contract-redline",
            matterId: "e2e-matter-1",
            createdAt: now,
            progress: { totalSteps: 2, completedSteps: 1, failedSteps: 0, runningStepIds: ["s2"] },
          }
        : {
            id: jobMatch[1],
            status: "completed",
            kind: "workflow",
            matterId: "e2e-matter-1",
            createdAt: now,
            updatedAt: now,
          },
    });
    return;
  }

  const jobStreamMatch = /^\/api\/jobs\/([^/]+)\/stream$/.exec(path);
  if (jobStreamMatch && req.method === "GET") {
    // SSE: emit one terminal frame then close the stream (renderer tolerates immediate end).
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    if (jobStreamMatch[1] === "e2e-wf-run") {
      res.write(
        `data: ${JSON.stringify({
          ok: true,
          job: {
            jobId: "e2e-wf-run",
            status: "running",
            progress: { totalSteps: 2, completedSteps: 1, failedSteps: 0, runningStepIds: ["s2"] },
          },
        })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          ok: true,
          job: {
            jobId: "e2e-wf-run",
            status: "completed",
            result: { status: "completed", report: "邮件合同审阅已完成（mock）：审阅稿已写入案件目录。" },
          },
        })}\n\n`,
      );
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ ok: true, job: { id: jobStreamMatch[1], status: "completed" } })}\n\n`);
    res.end();
    return;
  }

  const jobCancelMatch = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path);
  if (jobCancelMatch && req.method === "POST") {
    json(res, 200, { ok: true, cancelled: true, jobId: jobCancelMatch[1] });
    return;
  }

  // ── Collaboration workflow-run (async kickoff) ──────────────────────────────
  if (path === "/api/collaboration/workflow-run" && req.method === "POST") {
    const body = await readJsonBody(req);
    const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
    json(res, 200, {
      ok: true,
      jobId: `e2e-wf-${idempotencyKey ? idempotencyKey.slice(0, 8) : "1"}`,
      status: "queued",
      async: true,
    });
    return;
  }

  // ── Filesystem bridge (compose context picker / file embed) ─────────────────
  if (path === "/api/fs/tree" && req.method === "GET") {
    json(res, 200, { ok: true, entries: [] });
    return;
  }

  if (path === "/api/fs/read" && req.method === "GET") {
    json(res, 200, { ok: true, content: "" });
    return;
  }

  json(res, 404, { ok: false, error: "e2e mock: not found" });
});

ensureDefaultSessionSeeded();
server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`lawmind e2e mock listening on http://127.0.0.1:${PORT}\n`);
});
