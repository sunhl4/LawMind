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
import {
  buildDoctorStats,
  buildMemoryTruthSourceFlags,
  tryReadWorkspacePackageVersion,
} from "./lawmind-health-payload.js";
import {
  resolveAgentMandatoryRulesForPrompt,
  resolveAgentMaxToolCallsPerTurn,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { buildAgentConfig, sendJson } from "./lawmind-server-helpers.js";
import { LAWMIND_AGENT_BEHAVIOR_EPOCH } from "../../../src/lawmind/agent/system-prompt.js";

export function handleHealthRoute({ ctx, pathname, req, res, c }: LawmindRouteContext): boolean {
  if (!(pathname === "/api/health" && req.method === "GET")) {
    return false;
  }

  const { workspaceDir, envFile, userEnvPath, policy } = ctx;
  const { error } = buildAgentConfig(workspaceDir);
  const repoRootRaw = process.env.LAWMIND_REPO_ROOT?.trim();
  const repoEnvPath = repoRootRaw ? path.join(path.resolve(repoRootRaw), ".env.lawmind") : "";
  const retrievalMode =
    process.env.LAWMIND_RETRIEVAL_MODE?.trim().toLowerCase() === "dual" ? "dual" : "single";
  const dualLegalConfigured =
    createOpenSourceLegalAdaptersFromEnv().length + createPartnerLegalAdapterFromEnv().length > 0;
  const webSearchApiKeyConfigured = Boolean(resolveLawMindWebSearchApiKey());
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
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
      edition: {
        id: edition.edition,
        label: edition.label,
        source: edition.source,
        features: edition.features,
      },
      workspaceDir,
      lawMindRoot,
      modelConfigured: !error,
      missingApiKey: error === "missing_api_key",
      retrievalMode,
      dualLegalConfigured,
      webSearchApiKeyConfigured,
      doctor: {
        ...doctor,
        nodeVersion: process.version,
        lawmindPackageVersion,
        memoryTruthSources,
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
          }
        : { loaded: false },
    },
    c,
  );
  return true;
}
