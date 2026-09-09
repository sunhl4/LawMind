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
};
