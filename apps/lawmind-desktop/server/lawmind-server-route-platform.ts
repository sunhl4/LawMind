import { resolveConversationLength } from "../../../src/lawmind/agent/context-preset.js";
import { listPlatformGateHistory } from "../../../src/lawmind/platform/audit-gate.js";
import { mergeRecommendedLegalNetworkAllowlist } from "../../../src/lawmind/policy/network-allowlist.js";
import { isAnalysisScriptsAllowed } from "../../../src/lawmind/policy/analysis-scripts.js";
import {
  mergeWorkspacePolicyFile,
  readWorkspacePolicyFile,
  resolveEgressMode,
} from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawMindEgressMode } from "../../../src/lawmind/policy/workspace-policy.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { applyLawMindPolicyToEnv, isWebSearchForcedOffByPolicy, type LawMindPolicyFile } from "./lawmind-policy.js";
import { workspacePolicyPatchSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { isLawMindHttpError, sendJson } from "./lawmind-server-helpers.js";

export async function handlePlatformRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/policy/workspace" && req.method === "GET") {
    const policy = readWorkspacePolicyFile(ctx.workspaceDir);
    const egressMode = resolveEgressMode(policy);
    sendJson(
      res,
      200,
      {
        ok: true,
        // 「离线模式」是 egressMode 的别名，UI/MCP 统一看这两个派生值。
        egressMode,
        highSecurityMode: egressMode === "offline",
        allowAnalysisScripts: isAnalysisScriptsAllowed(ctx.workspaceDir),
        // 原始偏好：离线模式下被压制，但不被改写，退出离线后自动恢复。
        allowWebSearch: policy?.allowWebSearch,
        /** 运行进程当前是否真的在拦联网（env 闸）。 */
        webSearchForcedOff: isWebSearchForcedOffByPolicy(),
        networkAllowlist: policy?.networkAllowlist ?? [],
        hostAccess: policy?.hostAccess ?? {},
        conversationLength: resolveConversationLength(policy?.conversationLength),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/policy/workspace" && req.method === "PATCH") {
    let body;
    try {
      body = await parseJsonBodyZod(req, workspacePolicyPatchSchema);
    } catch (e) {
      if (isLawMindHttpError(e)) {
        sendJson(res, e.status, { ok: false, message: e.message }, c);
      } else if (isInvalidRequestBodyError(e)) {
        sendJson(res, 400, { ok: false, message: "invalid policy patch" }, c);
      } else {
        sendJson(res, 400, { ok: false, message: "invalid json" }, c);
      }
      return true;
    }
    // 只写「总模式」，绝不静默改写 allowWebSearch / allowAnalysisScripts /
    // productInsightsCollection —— 那些一律在读取时按 egressMode 推导，
    // 否则退出离线模式后律师的原偏好已被抹掉（历史 bug）。
    // 出站总模式（唯一权威）：schema 接受 open | allowlisted | offline 三种，
    // 这里就必须按同一联合收窄。此前声明成 `"offline" | undefined` 是旧口径残留
    // （highSecurityMode 时代只有开/关），会把「把离线改回 open」这条正常路径判成类型错，
    // 而运行时它一直是通的。
    const nextEgress: LawMindEgressMode | undefined =
      body.egressMode !== undefined
        ? body.egressMode
        : body.highSecurityMode !== undefined
          ? body.highSecurityMode
            ? "offline"
            : undefined
          : undefined;
    const clearEgress =
      body.highSecurityMode === false && body.egressMode === undefined;
    const merged = mergeWorkspacePolicyFile(ctx.workspaceDir, {
      ...(nextEgress !== undefined ? { egressMode: nextEgress } : {}),
      // 旧键不再写入；显式关掉时连旧键一起清掉，避免它继续把模式钉在 offline。
      ...(clearEgress ? { egressMode: undefined, highSecurityMode: undefined } : {}),
      ...(body.allowAnalysisScripts !== undefined
        ? { allowAnalysisScripts: body.allowAnalysisScripts }
        : {}),
      ...(body.hostAccess ? { hostAccess: body.hostAccess } : {}),
      ...(body.conversationLength !== undefined
        ? { conversationLength: body.conversationLength }
        : {}),
    });
    if (!merged.ok) {
      sendJson(res, 500, { ok: false, message: merged.error }, c);
      return true;
    }
    // 立即把新策略写回进程 env：否则「离线模式」只落到文件，
    // 正在跑的会话仍按旧的 LAWMIND_POLICY_FORCE_NO_WEB_SEARCH 放行联网，要重启才生效。
    applyLawMindPolicyToEnv(merged.policy as LawMindPolicyFile);
    const egressMode = resolveEgressMode(merged.policy);
    sendJson(
      res,
      200,
      {
        ok: true,
        egressMode,
        highSecurityMode: egressMode === "offline",
        allowAnalysisScripts: isAnalysisScriptsAllowed(ctx.workspaceDir),
        allowWebSearch: merged.policy.allowWebSearch,
        /** 运行进程当前是否真的在拦联网（env 闸已按新策略刷新）。 */
        webSearchForcedOff: isWebSearchForcedOffByPolicy(),
        hostAccess: merged.policy.hostAccess ?? {},
        conversationLength: resolveConversationLength(merged.policy.conversationLength),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/policy/workspace/recommended-allowlist" && req.method === "POST") {
    const policy = readWorkspacePolicyFile(ctx.workspaceDir);
    const networkAllowlist = mergeRecommendedLegalNetworkAllowlist(policy?.networkAllowlist);
    const merged = mergeWorkspacePolicyFile(ctx.workspaceDir, { networkAllowlist });
    if (!merged.ok) {
      sendJson(res, 500, { ok: false, message: merged.error }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        networkAllowlist: merged.policy.networkAllowlist ?? networkAllowlist,
        note: "已合并推荐法律检索主机；未强制开启联网或 networkAllowlistEnforced。",
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/platform/gate-history" && req.method === "GET") {
    const raw = url.searchParams.get("limit") ?? "60";
    const limit = Number.parseInt(raw, 10);
    const items = await listPlatformGateHistory(
      ctx.workspaceDir,
      Number.isFinite(limit) ? limit : 60,
    );
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  return false;
}
