import fs from "node:fs";
import path from "node:path";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../../src/lawmind/retrieval/providers.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import { resolveCitationMode } from "../../../src/lawmind/policy/citation-mode.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { listTriageRuleIds } from "../../../src/lawmind/triage/index.js";
import { fleetPlaybookCountForHealth } from "./lawmind-server-route-review-campaign.js";
import { summarizeProductMetrics } from "../../../src/lawmind/metrics/product-metrics.js";
import { runPrivateDeployChecklist } from "../../../src/lawmind/policy/private-deploy-checklist.js";
import { buildWorkspaceSessionHealth } from "../../../src/lawmind/insights/session-health.js";
import {
  buildAuthorityCorpusHealthSummary,
  buildDoctorStats,
  buildJudgmentHardControlsReport,
  buildMemoryTruthSourceFlags,
  buildMatterConsistencySummary,
  buildMultitaskObservabilitySummary,
  buildP2DoctorReport,
  buildTaskDraftConsistencySummary,
  buildWorkspaceStandardReport,
  tryReadWorkspacePackageVersion,
} from "./lawmind-health-payload.js";
import {
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isLoopbackApiAuthSkipped } from "./lawmind-local-api-auth.js";
import { getProcessHealthSignals } from "./lawmind-process-policy.js";
import { getRateLimitStats } from "./lawmind-local-rate-limit.js";
import { buildAgentConfig, isDesktopModelConfigured, sendJson } from "./lawmind-server-helpers.js";
import {
  buildModelCatalog,
  effectiveRouterMode,
  resolveDraftReasoningLlmConfig,
  readDraftWithModelStoreFlag,
} from "../../../src/lawmind/models/index.js";
import {
  LAWMIND_AGENT_BEHAVIOR_EPOCH,
  listSystemPromptSectionCatalog,
} from "../../../src/lawmind/agent/system-prompt.js";
import { summarizeModelUsage } from "../../../src/lawmind/models/model-usage.js";
import { buildIntegrationsHealthSummary } from "../../../src/lawmind/integrations/index.js";
import { getSearchIndexStatus } from "../../../src/lawmind/indexing/index.js";
import { computeSearchIndexFreshness } from "../../../src/lawmind/indexing/fts-search.js";
import {
  buildAuthorityCorpusSummary,
  isAuthorityCorpusReady,
  probeAuthorityEndpoint,
  resolveAuthorityApiKey,
  validateAuthorityEndpointUrl,
} from "../../../src/lawmind/retrieval/authority-health.js";
import { buildAuthorityUsageSummary } from "../../../src/lawmind/retrieval/authority-usage.js";
import { openLawCorpusStats } from "../../../src/lawmind/retrieval/providers/open-law/local-corpus.js";
import { summarizeOpenLawSources } from "../../../src/lawmind/retrieval/providers/open-law/sources.js";
import { lexisAdapterMessage } from "../../../src/lawmind/retrieval/providers/lexis/placeholder.js";
import {
  getBuildChannel,
  isPlatformAuthorityProxyEnabled,
} from "../../../src/lawmind/build-channel.js";
import { getGraphOAuthStatus } from "../../../src/lawmind/integrations/graph-oauth-placeholder.js";
import { getEsignIntegrationStatus } from "../../../src/lawmind/integrations/esign-placeholder.js";
import { getEmbeddingIndexConfig } from "../../../src/lawmind/indexing/embeddings/index.js";
import { getDaemonStatus } from "../../../src/lawmind/platform/lawmind-daemon.js";
import { sendJsonError } from "./lawmind-api-error.js";

export async function handleHealthRoute({ ctx, pathname, req, res, c }: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/authority/probe" && req.method === "POST") {
    const summary = buildAuthorityCorpusSummary();
    // Open-law: probe = local corpus ready (no commercial endpoint).
    if (summary.provider === "open") {
      if (!summary.configured || !isAuthorityCorpusReady(summary.status)) {
        sendJsonError(
          res,
          400,
          "authority_open_corpus_unset",
          summary.message || "开源语料未就绪。",
          c,
          { authorityCorpus: summary },
        );
        return true;
      }
      const stats = openLawCorpusStats();
      const openSources = summarizeOpenLawSources();
      sendJson(
        res,
        200,
        {
          ok: true,
          probe: {
            ok: true,
            latencyMs: 0,
            hitCount: stats.recordCount,
            error: undefined,
          },
          authorityCorpus: { ...summary, openSources: openSources.sources },
          openLawSources: openSources,
          note: "开源语料本地探测通过（非厂商付费库）。",
        },
        c,
      );
      return true;
    }
    // Lexis / unimplemented: never green-light HTTP against a placeholder.
    if (summary.provider === "lexis" || summary.status === "unimplemented") {
      sendJson(
        res,
        501,
        {
          ok: false,
          probe: {
            ok: false,
            latencyMs: 0,
            error: summary.provider === "lexis" ? lexisAdapterMessage() : summary.message,
          },
          authorityCorpus: summary,
          note:
            summary.provider === "lexis"
              ? "Lexis 适配器尚未实现；探测不会对占位端点报成功。"
              : "权威适配器尚未实现（status=unimplemented）；探测 fail-closed。",
        },
        c,
      );
      return true;
    }
    if (summary.status === "unset") {
      sendJsonError(
        res,
        400,
        "authority_endpoint_unset",
        summary.message || "未配置 LAWMIND_AUTHORITY_ENDPOINT，无法探测。",
        c,
        { authorityCorpus: summary },
      );
      return true;
    }
    if (summary.status === "invalid") {
      sendJsonError(
        res,
        400,
        "authority_endpoint_invalid",
        summary.message || "权威端点配置无效（fail-closed）。",
        c,
        { authorityCorpus: summary },
      );
      return true;
    }
    const raw = (process.env.LAWMIND_AUTHORITY_ENDPOINT ?? "").trim();
    const validated = validateAuthorityEndpointUrl(raw);
    if (!validated.ok) {
      sendJsonError(res, 400, "authority_endpoint_invalid", validated.message, c);
      return true;
    }
    const probe = await probeAuthorityEndpoint({
      endpoint: validated.normalized,
      apiKey: resolveAuthorityApiKey(),
    });
    sendJson(
      res,
      probe.ok ? 200 : 502,
      {
        ok: probe.ok,
        probe,
        authorityCorpus: summary,
      },
      c,
    );
    return true;
  }

  if (!(pathname === "/api/health" && req.method === "GET")) {
    return false;
  }

  const { workspaceDir, envFile, userEnvPath, policy } = ctx;
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  const catalog = buildModelCatalog(lawMindRoot);
  const built = buildAgentConfig(workspaceDir, { envFile });
  const { error: _error } = built;
  const modelConfigured = isDesktopModelConfigured(workspaceDir, envFile);
  const repoRootRaw = process.env.LAWMIND_REPO_ROOT?.trim();
  const repoEnvPath = repoRootRaw ? path.join(path.resolve(repoRootRaw), ".env.lawmind") : "";
  const retrievalMode =
    process.env.LAWMIND_RETRIEVAL_MODE?.trim().toLowerCase() === "dual" ? "dual" : "single";
  const dualLegalConfigured =
    createOpenSourceLegalAdaptersFromEnv().length + createPartnerLegalAdapterFromEnv().length > 0;
  const webSearchApiKeyConfigured = Boolean(resolveLawMindWebSearchApiKey());
  const doctor = buildDoctorStats(workspaceDir);
  const memoryTruthSources = buildMemoryTruthSourceFlags(workspaceDir);
  const lawmindPackageVersion = tryReadWorkspacePackageVersion(repoRootRaw);
  const policyForEdition: LawMindWorkspacePolicy | null = policy.loaded
    ? (policy.policy as LawMindWorkspacePolicy)
    : null;
  const edition = resolveEdition({ policy: policyForEdition });
  const citationMode = resolveCitationMode(policyForEdition, edition.edition);
  const triageRuleIds = listTriageRuleIds();
  const fleetPlaybookCount = fleetPlaybookCountForHealth(workspaceDir);
  const productMetrics = summarizeProductMetrics(workspaceDir);
  const privateDeployChecklist = runPrivateDeployChecklist(workspaceDir);
  const mandatoryRules = resolveAgentMandatoryRulesForPrompt(workspaceDir, policyForEdition);
  const lawmindRouterMode = effectiveRouterMode(lawMindRoot);
  const reasoningModeRaw = (process.env.LAWMIND_REASONING_MODE ?? "").trim().toLowerCase();
  const draftWithModelEnabled = readDraftWithModelStoreFlag(lawMindRoot);
  const draftWithModelActive = resolveDraftReasoningLlmConfig(lawMindRoot) !== null;
  const lawmindReasoningMode =
    reasoningModeRaw || (draftWithModelActive ? "model" : "off");
  const lawmindAgentMaxToolCalls = resolveAgentMaxToolCallsPerTurn(workspaceDir);
  const capabilityEnvelope = {
    contextTokens: built.config?.model?.contextTokens ?? null,
    maxOutputTokens: built.config?.model?.maxTokens ?? null,
    temperature: built.config?.model?.temperature ?? null,
    toolCallsPerTurn: lawmindAgentMaxToolCalls,
    maxHistoryMessages: built.config?.maxHistoryMessages ?? null,
  };
  const usageSummary = summarizeModelUsage(workspaceDir, { sinceDays: 30 });
  const matterConsistency = await buildMatterConsistencySummary(workspaceDir);
  const taskDraftConsistency = buildTaskDraftConsistencySummary(workspaceDir);
  const multitaskObservability = buildMultitaskObservabilitySummary(workspaceDir);
  const authorityCorpus = buildAuthorityCorpusHealthSummary();
  const authorityUsage = buildAuthorityUsageSummary(workspaceDir);
  const buildChannel = getBuildChannel();
  const embeddingIndex = getEmbeddingIndexConfig();
  const graphOAuth = getGraphOAuthStatus();
  const esign = getEsignIntegrationStatus();

  sendJson(
    res,
    200,
    {
      ok: true,
      buildChannel,
      platformAuthorityProxyEnabled: isPlatformAuthorityProxyEnabled(),
      lawmindAgentBehaviorEpoch: LAWMIND_AGENT_BEHAVIOR_EPOCH,
      promptSections: listSystemPromptSectionCatalog(),
      lawmindClarificationProtocol: "v1",
      lawmindAgentMaxToolCalls,
      lawmindDaemon: getDaemonStatus(workspaceDir),
      capabilityEnvelope,
      agentMandatoryRulesActive: mandatoryRules.active,
      agentMandatoryRulesTruncated: mandatoryRules.truncated,
      citationMode,
      citationModeActive: citationMode !== "off",
      triageRulesLoaded: triageRuleIds.length > 0,
      triageRuleCount: triageRuleIds.length,
      fleetPlaybooksLoaded: fleetPlaybookCount > 0,
      fleetPlaybookCount,
      lawmindRouterMode,
      lawmindReasoningMode,
      draftWithModelEnabled,
      draftWithModelActive,
      edition: {
        id: edition.edition,
        label: edition.label,
        source: edition.source,
        features: edition.features,
      },
      workspaceDir,
      lawMindRoot,
      modelConfigured,
      missingApiKey: !modelConfigured,
      defaultModelId: catalog.defaultModelId,
      modelName: built.config?.model?.model ?? null,
      modelBaseUrl: built.config?.model?.baseUrl ?? null,
      activeModelId: built.modelId ?? catalog.defaultModelId,
      modelEnvFile: userEnvPath,
      modelEnvFileExists: fs.existsSync(userEnvPath),
      modelProviders: catalog.providers,
      retrievalMode,
      dualLegalConfigured,
      webSearchApiKeyConfigured,
      usageSummary,
      doctor: {
        ...doctor,
        nodeVersion: process.version,
        lawmindPackageVersion,
        memoryTruthSources,
        workspaceStandard: buildWorkspaceStandardReport(workspaceDir),
        sessionHealth: buildWorkspaceSessionHealth(workspaceDir),
        usageSummary,
        integrations: buildIntegrationsHealthSummary(workspaceDir),
        searchIndex: (() => {
          const s = getSearchIndexStatus(workspaceDir);
          const freshness = computeSearchIndexFreshness(s);
          return {
            ready: s.ready,
            schemaVersion: s.schemaVersion,
            lastRebuildAt: s.lastRebuildAt,
            auditRows: s.auditRows,
            sessionRows: s.sessionRows,
            knowledgeRows: s.knowledgeRows,
            rowCount: (s.auditRows ?? 0) + (s.sessionRows ?? 0) + (s.knowledgeRows ?? 0),
            truncated: s.truncated,
            stale: freshness.stale,
            staleReason: freshness.staleReason,
          };
        })(),
        p2: buildP2DoctorReport(workspaceDir),
        matterConsistency,
        taskDraftConsistency,
        multitaskObservability,
        authorityCorpus,
        authorityUsage,
        embeddingIndex: {
          enabled: embeddingIndex.enabled,
          modelId: embeddingIndex.modelId,
          dimensions: embeddingIndex.dimensions,
        },
        graphOAuth: {
          implemented: graphOAuth.implemented,
          configuredClientId: graphOAuth.configuredClientId,
          message: graphOAuth.message,
        },
        esign: {
          implemented: esign.implemented,
          provider: esign.provider,
          message: esign.message,
        },
        rateLimit: getRateLimitStats(),
        skipApiAuthWarn: isLoopbackApiAuthSkipped(),
        // 进程级异常信号：uncaughtException 会干净退出由监督层重启；
        // unhandledRejection 带病继续（可用性优先），此处暴露恶化信号。
        process: getProcessHealthSignals(),
        citationMode,
        citationModeActive: citationMode !== "off",
        triageRulesLoaded: triageRuleIds.length > 0,
        triageRuleCount: triageRuleIds.length,
        fleetPlaybooksLoaded: fleetPlaybookCount > 0,
        fleetPlaybookCount,
        productMetricsSummary: {
          total: productMetrics.total,
          triageConfirmed: productMetrics.triageConfirmed,
          gateFailures: productMetrics.gateFailures,
          firstPassOk: productMetrics.firstPassOk,
          rewrites: productMetrics.rewrites,
          rewriteAmplitudeSamples: productMetrics.byKind.rewrite_amplitude ?? 0,
        },
        privateDeployChecklist: {
          applicable: privateDeployChecklist.applicable,
          passCount: privateDeployChecklist.passCount,
          total: privateDeployChecklist.items.length,
          items: privateDeployChecklist.items,
        },
        judgmentHardControls: buildJudgmentHardControlsReport(),
      },
      envHint: {
        userDataEnvPath: userEnvPath,
        userDataEnvExists: fs.existsSync(userEnvPath),
        repoEnvPath: repoEnvPath || null,
        repoEnvExists: repoEnvPath ? fs.existsSync(repoEnvPath) : false,
      },
      policy: policy.loaded
        ? {
            loaded: true,
            path: policy.path,
            applied: policy.applied,
            allowWebSearch: policy.policy.allowWebSearch ?? null,
            retrievalMode: policy.policy.retrievalMode ?? null,
            enableCollaboration: policy.policy.enableCollaboration ?? null,
            networkAllowlist: policy.policy.networkAllowlist ?? null,
            networkAllowlistEnforced: policy.policy.networkAllowlistEnforced ?? null,
          }
        : { loaded: false },
    },
    c,
  );
  return true;
}
