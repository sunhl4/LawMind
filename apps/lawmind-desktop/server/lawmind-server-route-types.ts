import type http from "node:http";
import type { LawMindPolicyState } from "./lawmind-policy.js";
import type { LawmindSseBus } from "./lawmind-sse-bus.js";

export type LawmindDispatchContext = {
  workspaceDir: string;
  envFile: string | undefined;
  userEnvPath: string;
  policy: LawMindPolicyState;
  sseBus?: LawmindSseBus;
};

export type LawmindRouteContext = {
  ctx: LawmindDispatchContext;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  pathname: string;
  c: Record<string, string>;
  /**
   * 本次请求的已认证客户端身份（`desktop` / `renderer` / `word-addin` / `cli` /
   * `shared`）。用于审计归属与最小权限；由 dispatch 解析后传入，路由只读。
   */
  clientId?: string;
};
