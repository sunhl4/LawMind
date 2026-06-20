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

const e2eRequiresAction = [
  {
    id: "ra-tool-1",
    kind: "tool_approval",
    threadId: `${sessionId}:turn`,
    title: "待批准：执行工作流",
    summary: "系统准备执行 execute_workflow，请确认。",
    toolName: "execute_workflow",
    toolArgs: { workflowId: "e2e-default" },
    decisions: ["approve", "reject"],
    createdAt: now,
  },
];

const assistant = {
  assistantId: "default",
  displayName: "默认助手",
  introduction: "E2E mock",
  presetKey: "general",
  createdAt: now,
  updatedAt: now,
  stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
};

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

const healthPayload = {
  modelConfigured: true,
  modelName: "qwen-plus",
  retrievalMode: "single",
  dualLegalConfigured: false,
  webSearchApiKeyConfigured: false,
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
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (path === "/api/health" && req.method === "GET") {
    json(res, 200, healthPayload);
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
    json(res, 200, { ok: true, assistants: [assistant], presets: [] });
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
          detail: "验收门禁已计算",
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
    json(res, 200, {
      ok: true,
      sessions: [{ sessionId, title: "New Chat", updatedAt: now }],
    });
    return;
  }

  if (path === "/api/sessions" && req.method === "POST") {
    json(res, 200, { ok: true, sessionId });
    return;
  }

  if (path === "/api/sessions/delete" && req.method === "POST") {
    json(res, 200, { ok: true });
    return;
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      messages: [
        {
          role: "assistant",
          text: "需要您确认后我才能继续执行。",
          requiresAction: e2eRequiresAction,
        },
      ],
    });
    return;
  }

  if (path === "/api/drafts" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      drafts: [
        {
          taskId: "e2e-draft-1",
          title: "E2E draft",
          summary: "E2E summary",
          output: "docx",
          templateId: "review-contract-default",
          reviewStatus: "pending",
          matterId: "e2e-matter-1",
          reviewNotes: [],
          sections: [{ heading: "摘要", body: "E2E body" }],
          createdAt: now,
        },
      ],
    });
    return;
  }

  const renderTrackedMatch = /^\/api\/drafts\/([^/]+)\/render-tracked$/.exec(path);
  if (renderTrackedMatch && req.method === "POST") {
    json(res, 200, {
      ok: true,
      outputPath: "artifacts/e2e-tracked.docx",
      mode: "officecli",
    });
    return;
  }

  const draftMatch = /^\/api\/drafts\/([^/]+)$/.exec(path);
  if (draftMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      draft: {
        taskId: draftMatch[1],
        title: "E2E draft",
        summary: "E2E summary",
        output: "docx",
        templateId: "review-contract-default",
        deliverableType: "contract.review",
        reviewStatus: "pending",
        matterId: "e2e-matter-1",
        reviewNotes: [],
        sections: [{ heading: "摘要", body: "E2E body" }],
        createdAt: now,
      },
      acceptance: {
        ready: false,
        blockerCount: 1,
        placeholderCount: 0,
        deliverableType: "contract.review",
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
          reason: "验收门禁存在阻塞项。",
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
        sections: [{ heading: "摘要", body: "E2E body" }],
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
          reason: "验收门禁存在阻塞项。",
        },
      ],
    });
    return;
  }

  if (path === "/api/action-summary" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      total: 1,
      pendingApprovals: 0,
      openQueueItems: 0,
      activeJobs: 0,
      chatRequiresActionCount: 1,
    });
    return;
  }

  const contextBudgetMatch = /^\/api\/sessions\/([^/]+)\/context-budget$/.exec(path);
  if (contextBudgetMatch && req.method === "GET") {
    json(res, 200, {
      ok: true,
      used: 12_000,
      effectiveLimit: 100_000,
      level: "ok",
    });
    return;
  }

  if (path === "/api/chat" && req.method === "POST") {
    const body = await readJsonBody(req);
    const msg = typeof body?.message === "string" ? body.message : "";
    const delayMs = msg.includes("e2e-slow") ? 2500 : 0;
    const payload = {
      ok: true,
      sessionId,
      reply: delayMs > 0 ? "E2E 慢速回复完成。" : "需要您确认后我才能继续执行。",
      requiresAction: delayMs > 0 ? [] : e2eRequiresAction,
    };
    if (delayMs > 0) {
      setTimeout(() => json(res, 200, payload), delayMs);
      return;
    }
    json(res, 200, payload);
    return;
  }

  if (path === "/api/chat/resume" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(res, 200, {
      ok: true,
      sessionId,
      reply: "已按您的确认继续处理。",
      requiresAction: [],
      resumeEcho: {
        decision: body?.decision ?? null,
        editedArgs: body?.editedArgs ?? null,
      },
    });
    return;
  }

  if (path === "/api/bootstrap" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      health: healthPayload,
      assistants: [assistant],
      presets: [],
    });
    return;
  }

  json(res, 404, { ok: false, error: "e2e mock: not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`lawmind e2e mock listening on http://127.0.0.1:${PORT}\n`);
});
