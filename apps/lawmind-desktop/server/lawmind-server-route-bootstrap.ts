import { listAssistantPresets } from "../../../src/lawmind/agent/assistant-presets.js";
import {
  loadAssistantProfiles,
  loadAssistantStats,
  resolveLawMindRoot,
} from "../../../src/lawmind/assistants/store.js";
import { resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { isResolvedModelVerified } from "../../../src/lawmind/models/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { buildAgentConfig, isDesktopModelConfigured, sendJson } from "./lawmind-server-helpers.js";
import { buildRuntimeCapabilityFlags } from "./lawmind-health-payload.js";

export function handleBootstrapRoute({ ctx, pathname, req, res, c }: LawmindRouteContext): boolean {
  if (!(pathname === "/api/bootstrap" && req.method === "GET")) {
    return false;
  }

  const { workspaceDir, envFile, policy } = ctx;
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  const modelConfigured = isDesktopModelConfigured(workspaceDir, envFile);
  const built = buildAgentConfig(workspaceDir, { envFile });
  const modelVerified = isResolvedModelVerified(lawMindRoot, built.modelId);
  // 渲染层只把 /api/bootstrap 的 health 当全量 health 用（见 mapHealthState）：
  // 联网检索、检索模式、起草大模型这些标志都必须在这里给出，否则设置页会一直停在默认态。
  const capabilityFlags = buildRuntimeCapabilityFlags({
    lawMindRoot,
    chatModel: built.config?.model,
  });
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

  // 任务 / 草稿 / 案件计数不放在这条首屏路径上。渲染层另有 /api/tasks 与 /api/history，
  // 体检计数留在 /api/health。在这里再扫一遍会和那两条请求抢同一条事件循环。
  sendJson(
    res,
    200,
    {
      ok: true,
      health: {
        modelConfigured,
        modelVerified,
        missingApiKey: !modelConfigured,
        modelError: built.error ?? null,
        modelName: built.config?.model?.model ?? null,
        draftWithModelEnabled: capabilityFlags.draftWithModelEnabled,
        draftWithModelActive: capabilityFlags.draftWithModelActive,
        retrievalMode: capabilityFlags.retrievalMode,
        dualLegalConfigured: capabilityFlags.dualLegalConfigured,
        webSearchApiKeyConfigured: capabilityFlags.webSearchApiKeyConfigured,
        webSearchNativeAvailable: capabilityFlags.webSearchNativeAvailable,
        webSearchReady: capabilityFlags.webSearchReady,
        // mapHealthState 用 policy.allowWebSearch 判定 webSearchPolicyBlocked。
        policy: policy.loaded
          ? { loaded: true, allowWebSearch: policy.policy.allowWebSearch ?? null }
          : { loaded: false },
      },
      edition: {
        id: edition.edition,
        label: edition.label,
        features: edition.features,
      },
      assistants,
      presets: listAssistantPresets(),
    },
    c,
  );
  return true;
}
