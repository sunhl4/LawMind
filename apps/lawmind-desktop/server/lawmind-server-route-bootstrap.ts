import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import { listMatterIds } from "../../../src/lawmind/cases/index.js";
import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import {
  loadAssistantProfiles,
  loadAssistantStats,
  resolveLawMindRoot,
} from "../../../src/lawmind/assistants/store.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { listTaskRecords } from "../../../src/lawmind/tasks/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { buildAgentConfig, isDesktopModelConfigured, sendJson } from "./lawmind-server-helpers.js";
import { buildDoctorStats, buildMemoryTruthSourceFlags } from "./lawmind-health-payload.js";

export async function handleBootstrapRoute({ ctx, pathname, req, res, c }: LawmindRouteContext): Promise<boolean> {
  if (!(pathname === "/api/bootstrap" && req.method === "GET")) {
    return false;
  }

  const { workspaceDir, envFile, policy } = ctx;
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  const modelConfigured = isDesktopModelConfigured(workspaceDir, envFile);
  const built = buildAgentConfig(workspaceDir, { envFile });
  const policyForEdition: LawMindWorkspacePolicy | null = policy.loaded
    ? (policy.policy as LawMindWorkspacePolicy)
    : null;
  const edition = resolveEdition({ policy: policyForEdition });

  const profiles = loadAssistantProfiles(lawMindRoot);
  const stats = loadAssistantStats(lawMindRoot);
  const assistants = profiles.map((profile) => ({
    assistantId: profile.assistantId,
    displayName: profile.displayName,
    orgRole: profile.orgRole,
    stats: stats[profile.assistantId] ?? { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
  }));

  const tasks = listTaskRecords(workspaceDir);
  const drafts = listDrafts(workspaceDir);
  const matters = await listMatterIds(workspaceDir);

  sendJson(
    res,
    200,
    {
      ok: true,
      health: {
        modelConfigured,
        missingApiKey: !modelConfigured,
        modelError: built.error ?? null,
        doctor: buildDoctorStats(workspaceDir),
        memoryTruthSources: buildMemoryTruthSourceFlags(workspaceDir),
      },
      edition: {
        id: edition.edition,
        label: edition.label,
        features: edition.features,
      },
      assistants,
      presets: listAssistantPresets(),
      records: {
        taskCount: tasks.length,
        draftCount: drafts.length,
        matterCount: matters.length,
        pendingReviewCount: drafts.filter((d) => d.reviewStatus === "pending").length,
      },
    },
    c,
  );
  return true;
}
