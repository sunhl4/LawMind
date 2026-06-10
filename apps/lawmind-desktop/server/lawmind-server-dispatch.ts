import http from "node:http";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import {
  LAWMIND_LOCAL_HOST,
  corsHeaders,
  isLawMindHttpError,
  sendJson,
} from "./lawmind-server-helpers.js";
import { validateLoopbackApiAuth } from "./lawmind-local-api-auth.js";
import { dispatchLawmindRoute } from "./lawmind-server-route-registry.js";

export async function lawmindHandleHttpRequest(
  ctx: LawmindDispatchContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  const c = corsHeaders(typeof origin === "string" ? origin : undefined);

  if (req.method === "OPTIONS") {
    res.writeHead(204, c);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${LAWMIND_LOCAL_HOST}`);
  const pathname = url.pathname;

  if (!validateLoopbackApiAuth(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized", code: "invalid_api_token" }, c);
    return;
  }

  try {
    const handled = await dispatchLawmindRoute({ ctx, req, res, url, pathname, c });
    if (handled) {
      return;
    }

    sendJson(
      res,
      404,
      {
        ok: false,
        error: "not found",
        code: "no_route",
        hint:
          "本机路由未匹配。若刚升级 LawMind，请在工作区根执行 pnpm lawmind:bundle:desktop-server（或 pnpm --filter lawmind-desktop bundle:server）后重启桌面端，或重启当前开发用的本地服务进程。",
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
