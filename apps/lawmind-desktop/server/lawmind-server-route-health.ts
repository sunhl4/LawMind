import fs from "node:fs";
import path from "node:path";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../../src/lawmind/retrieval/providers.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { buildWorkspaceSessionHealth } from "../../../src/lawmind/insights/session-health.js";
import {
  buildDoctorStats,
  buildMemoryTruthSourceFlags,
  buildMatterConsistencySummary,
  buildP2DoctorReport,
  buildWorkspaceStandardReport,
  tryReadWorkspacePackageVersion,
} from "./lawmind-health-payload.js";
import {
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isLoopbackApiAuthSkipped } from "./lawmind-local-api-auth.js";
import { getRateLimitStats } from "./lawmind-local-rate-limit.js";
import { buildAgentConfig, isDesktopModelConfigured, sendJson } from "./lawmind-server-helpers.js";
import { buildModelCatalog, resolveDraftReasoningLlmConfig, readDraftWithModelStoreFlag } from "../../../src/lawmind/models/index.js";
import { LAWMIND_AGENT_BEHAVIOR_EPOCH } from "../../../src/lawmind/agent/system-prompt.js";
import { summarizeModelUsage } from "../../../src/lawmind/models/model-usage.js";
import { buildIntegrationsHealthSummary } from "../../../src/lawmind/integrations/index.js";
import { getSearchIndexStatus } from "../../../src/lawmind/indexing/index.js";

export async function handleHealthRoute({ ctx, pathname, req, res, c }: LawmindRouteContext): Promise<boolean> {
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
  const mandatoryRules = resolveAgentMandatoryRulesForPrompt(workspaceDir, policyForEdition);
  const lawmindRouterMode = (process.env.LAWMIND_ROUTER_MODE ?? "").trim() || "keyword";
  const lawmindReasoningMode = (process.env.LAWMIND_REASONING_MODE ?? "").trim() || "off";
  const lawmindAgentMaxToolCalls = resolveAgentMaxToolCallsPerTurn(workspaceDir);
  const draftWithModelEnabled = readDraftWithModelStoreFlag(lawMindRoot);
  const draftWithModelActive = resolveDraftReasoningLlmConfig(lawMindRoot) !== null;
  const usageSummary = summarizeModelUsage(workspaceDir, { sinceDays: 30 });
  const matterConsistency = await buildMatterConsistencySummary(workspaceDir);

  sendJson(
    res,
    200,
    {
      ok: true,
      lawmindAgentBehaviorEpoch: LAWMIND_AGENT_BEHAVIOR_EPOCH,
      lawmindClarificationProtocol: "v1",
      lawmindAgentMaxToolCalls,
      agentMandatoryRulesActive: mandatoryRules.active,
      agentMandatoryRulesTruncated: mandatoryRules.truncated,
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
          return {
            ready: s.ready,
            schemaVersion: s.schemaVersion,
            lastRebuildAt: s.lastRebuildAt,
            auditRows: s.auditRows,
            sessionRows: s.sessionRows,
            rowCount: (s.auditRows ?? 0) + (s.sessionRows ?? 0),
            truncated: s.truncated,
          };
        })(),
        p2: buildP2DoctorReport(workspaceDir),
        matterConsistency,
        rateLimit: getRateLimitStats(),
        skipApiAuthWarn: isLoopbackApiAuthSkipped(),
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
