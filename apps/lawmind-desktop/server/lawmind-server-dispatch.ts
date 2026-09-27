import http from "node:http";
import {
  LOCAL_API_CLIENTS,
  LOCAL_API_DISCOVERY_PATH,
  LEGACY_SHARED_CLIENT,
  isClientAllowedForRequest,
} from "../electron/local-api-credentials.mjs";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import {
  LAWMIND_LOCAL_HOST,
  corsHeaders,
  isLawMindHttpError,
  loopbackBaseFromRequest,
  sendJson,
} from "./lawmind-server-helpers.js";
import {
  getLocalApiEpoch,
  getLocalApiInstanceId,
  isLoopbackApiAuthSkipped,
  resolveLoopbackClient,
  validateLoopbackHttpHost,
  validateLoopbackMutationContentType,
} from "./lawmind-local-api-auth.js";
import { dispatchLawmindRoute } from "./lawmind-server-route-registry.js";

/**
 * 发现端点载荷（RFC 9728 Protected Resource Metadata 的**形状**，但只回非秘密字段）。
 *
 * 为什么要有它：客户端必须在「启动时」和「收到 401 时」能自己重新发现坐标，否则
 * 一旦坐标变化（换端口 / 轮换代次）客户端只能人工重载 —— 这正是本机 API 改造前的病根。
 * 它**不含任何秘密**（没有令牌、没有安装密钥），所以可以免 bearer；仍受回环 Host 校验，
 * 且 `corsHeaders` 只对回环来源放行，浏览器侧读不到响应内容。
 *
 * `credentialModel` 是给将来用的接缝：LawMind 若把自己作为 MCP server 暴露给外部
 * agent，同一个端点长出 `authorization_servers` 就能接上标准 OAuth，不必重新设计。
 */
function buildDiscoveryPayload(req: http.IncomingMessage): Record<string, unknown> {
  return {
    ok: true,
    base: loopbackBaseFromRequest(req),
    instanceId: getLocalApiInstanceId(),
    epoch: getLocalApiEpoch(),
    clients: LOCAL_API_CLIENTS,
    credentialModel: "derived-hmac-sha256",
  };
}

export async function lawmindHandleHttpRequest(
  ctx: LawmindDispatchContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  const c = corsHeaders(typeof origin === "string" ? origin : undefined);

  if (!validateLoopbackHttpHost(req)) {
    sendJson(
      res,
      400,
      { ok: false, error: "invalid_host", code: "loopback_host_required" },
      c,
    );
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, c);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${LAWMIND_LOCAL_HOST}`);
  const pathname = url.pathname;

  // 发现端点：客户端此刻还没有凭据（鸡生蛋），故免 bearer；边界未放宽——仍在回环
  // Host 校验之后，且载荷不含秘密，浏览器侧因 CORS 白名单读不到。
  if (pathname === LOCAL_API_DISCOVERY_PATH && req.method === "GET") {
    sendJson(res, 200, buildDiscoveryPayload(req), c);
    return;
  }

  // Word 插件任务窗格：Word 取页面时还不持有令牌（鸡生蛋），故静态资源不带 bearer。
  // 边界未放宽——仍在回环 Host 校验之后，且页面里的凭据只发给回环来源；
  // 数据面（/api/word-addin/*）照旧走下面的统一鉴权。
  const isWordAddinStatic =
    (pathname === "/word-addin" || pathname.startsWith("/word-addin/")) && req.method === "GET";

  let clientId: string;
  if (isWordAddinStatic) {
    // 静态面身份只能标成插件（页面自己去同源 config.js 取凭据）；数据面才是真鉴权。
    clientId = "word-addin";
  } else if (isLoopbackApiAuthSkipped()) {
    // dev 覆盖开关（打包版已被忽略）：语义与改造前一致，记为 shared。
    clientId = LEGACY_SHARED_CLIENT;
  } else {
    const resolved = resolveLoopbackClient(req);
    if (!resolved) {
      sendJson(res, 401, { ok: false, error: "unauthorized", code: "invalid_api_token" }, c);
      return;
    }
    // 最小权限：认出是谁之后才知道它能不能碰这条路由。默认拒绝。
    if (!isClientAllowedForRequest(resolved, req.method, pathname)) {
      sendJson(
        res,
        403,
        {
          ok: false,
          error: "forbidden",
          code: "client_scope_forbidden",
          clientId: resolved,
        },
        c,
      );
      return;
    }
    clientId = resolved;
  }

  // dev skip-auth 下的 CSRF 收口：变更类请求必须是 application/json（simple request
  // 无法伪造该头而不触发预检）。认证开启时 bearer 头本身已要求预检，无需再查。
  if (!validateLoopbackMutationContentType(req)) {
    sendJson(
      res,
      415,
      {
        ok: false,
        error: "unsupported_media_type",
        code: "mutation_requires_json_content_type",
      },
      c,
    );
    return;
  }

  try {
    const handled = await dispatchLawmindRoute({
      ctx,
      req,
      res,
      url,
      pathname,
      c,
      clientId,
    });
    if (handled) {
      return;
    }

    console.error(
      "[LawMind] no_route",
      pathname,
      "开发态若刚改了路由，在工作区根执行 pnpm lawmind:bundle:desktop-server 后重启本地服务。",
    );
    sendJson(
      res,
      404,
      {
        ok: false,
        error: "not found",
        code: "no_route",
        hint: "这一步没能完成。请退出 LawMind 后重新打开。",
      },
      c,
    );
  } catch (err) {
    if (isLawMindHttpError(err)) {
      sendJsonError(res, err.status, err.code, err.message, c);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    sendJsonError(res, 500, "internal_error", msg, c);
  }
}
