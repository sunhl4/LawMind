import fs from "node:fs";
import path from "node:path";
import { resolveLawMindWebSearchApiKey } from "../../../src/lawmind/agent/tools/lawmind-web-search.js";
import {
  createOpenSourceLegalAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
} from "../../../src/lawmind/retrieval/providers.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { buildDoctorStats, tryReadOpenClawPackageVersion } from "./lawmind-health-payload.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { buildAgentConfig, sendJson } from "./lawmind-server-helpers.js";

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
  const openclawPackageVersion = tryReadOpenClawPackageVersion(repoRootRaw);

  sendJson(
    res,
    200,
    {
      ok: true,
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
        openclawPackageVersion,
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
