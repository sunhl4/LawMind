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
  citationMode: "assisted",
  citationModeActive: true,
  triageRulesLoaded: true,
  triageRuleCount: 3,
  doctor: {
    citationMode: "assisted",
    citationModeActive: true,
    triageRulesLoaded: true,
    triageRuleCount: 3,
    productMetricsSummary: { total: 3, triageConfirmed: 1, gateFailures: 0, firstPassOk: 1 },
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
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (path === "/api/health" && req.method === "GET") {
    json(res, 200, healthPayload);
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
            hint: "请补齐相对方全称。",
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
        deliverableType: "contract.review",
        matterId: "e2e-matter-1",
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

  if (reviewMatch && req.method === "POST") {
    const body = await readJsonBody(req);
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
    }
    json(res, 200, {
      ok: true,
      draft: {
        taskId: reviewMatch[1],
        title: "E2E draft",
        reviewStatus: body?.status ?? "pending",
        deliverableType: "contract.review",
        matterId: "e2e-matter-1",
        sections: [{ heading: "摘要", body: "E2E body" }],
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
    json(res, 200, { ok: true, outputPath: "artifacts/e2e.docx" });
    return;
  }

  if (path === "/api/action-summary" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      total: 2,
      requiresDecisionTotal: 2,
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

  if (path === "/api/agent-fleet" && req.method === "GET") {
    json(res, 200, {
      ok: true,
      runs: [
        {
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
        },
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
      ],
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
        total: 2,
        active: 2,
        awaitingAction: 2,
        byKind: {
          chat: 1,
          delegation: 0,
          workflow_job: 0,
          queue_item: 0,
          tool_approval: 0,
          matter_approval: 0,
          pending_review: 1,
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
        title: "E2E 交办任务",
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

  json(res, 404, { ok: false, error: "e2e mock: not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`lawmind e2e mock listening on http://127.0.0.1:${PORT}\n`);
});
