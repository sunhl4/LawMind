/**
 * Microsoft Graph OAuth wizard seam (C3-1 / G8).
 * Not wired to live Azure app — USER must register Entra ID app.
 */

export const GRAPH_OAUTH_USER_ACTIONS = [
  "在 Azure Entra ID 注册应用（委托权限：Mail.Read、Calendars.Read 按需）",
  "配置重定向 URI（LawMind 桌面 loopback，需 PKCE）",
  "将 clientId 写入 LAWMIND_GRAPH_CLIENT_ID（勿把 client secret 进 OSS 构建）",
  "完成首次 OAuth 后把 refresh token 存钥匙串（electron key-vault）",
  "联调 GET /me/messages 只读 → 再做归档进 matter",
] as const;

export type GraphOAuthStatus = {
  implemented: false;
  configuredClientId: boolean;
  message: string;
  userActions: readonly string[];
};

export function getGraphOAuthStatus(): GraphOAuthStatus {
  const configuredClientId = Boolean(process.env.LAWMIND_GRAPH_CLIENT_ID?.trim());
  return {
    implemented: false,
    configuredClientId,
    message: configuredClientId
      ? "已检测到 LAWMIND_GRAPH_CLIENT_ID，但 OAuth 向导尚未实现（占位）。"
      : "Microsoft Graph OAuth 未实现：请按 EXTERNAL-INTEGRATIONS C3 完成应用注册后接线。",
    userActions: GRAPH_OAUTH_USER_ACTIONS,
  };
}
