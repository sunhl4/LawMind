import type http from "node:http";
import type { LawMindPolicyState } from "./lawmind-policy.js";

export type LawmindDispatchContext = {
  workspaceDir: string;
  envFile: string | undefined;
  userEnvPath: string;
  policy: LawMindPolicyState;
};

export type LawmindRouteContext = {
  ctx: LawmindDispatchContext;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  pathname: string;
  c: Record<string, string>;
};
