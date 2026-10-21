/** Per-call evidence, not configuration readiness. No query text or vendor secrets. */
export type AuthorityCallStatus =
  | "ok"
  | "empty"
  | "quota_exhausted"
  | "rate_limited"
  | "unauthorized"
  | "unavailable"
  | "invalid_response"
  | "not_configured";

export type AuthorityCallOutcome = {
  status: AuthorityCallStatus;
  httpStatus?: number;
  hitCount: number;
};

export function authorityCallSucceeded(status: AuthorityCallStatus): boolean {
  return status === "ok" || status === "empty";
}

export function authorityHttpStatus(status: number): AuthorityCallStatus {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 402) {
    return "quota_exhausted";
  }
  if (status === 429) {
    return "rate_limited";
  }
  return "unavailable";
}

/** Fixed local copy: never promote raw vendor error text into model instructions. */
export function authorityFailureMessage(status: AuthorityCallStatus): string {
  switch (status) {
    case "quota_exhausted":
      return "权威库提示积分或额度不足，本次未完成检索。";
    case "rate_limited":
      return "权威库暂时限流，本次未完成检索。";
    case "unauthorized":
      return "权威库鉴权失败，请检查访问权限。";
    case "invalid_response":
      return "权威库返回格式异常，无法确认本次检索结果。";
    case "not_configured":
      return "权威库尚未配置。";
    default:
      return "权威库暂时不可用，本次未完成检索。";
  }
}
