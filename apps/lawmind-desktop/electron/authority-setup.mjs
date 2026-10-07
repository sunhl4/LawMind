/**
 * Desktop 「连接权威库」保存计划。
 *
 * 非秘密项写入 `.env.lawmind`；访问令牌由调用方放进钥匙串，再从 env 文件抹掉明文。
 * 官方地址与 `.env.lawmind.team.example` 同一对网关。协议按主机名选择，律师不用填。
 */

export const PKULAW_DEFAULT_LAW_ENDPOINT =
  "https://apim-gateway.pkulaw.com/mcp-law-search-service";
export const PKULAW_DEFAULT_CASE_ENDPOINT =
  "https://apim-gateway.pkulaw.com/mcp-case-search-service";

export const AUTHORITY_API_KEY_ENV = "LAWMIND_AUTHORITY_API_KEY";

const MODE_ENV_KEYS = [
  "LAWMIND_PKULAW_MODE",
  "LAWMIND_PKULAW_MCP_LAW_TOOL",
  "LAWMIND_PKULAW_MCP_CASE_TOOL",
];

/** @param {string} endpoint */
export function endpointWantsPkulawGateway(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.hostname === "apim-gateway.pkulaw.com" || url.pathname.includes("/mcp-");
  } catch {
    return false;
  }
}

/**
 * @param {string} raw
 * @returns {{ ok: true, normalized: string } | { ok: false, message: string }}
 */
export function validateAuthoritySetupUrl(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, message: "地址为空" };
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "不是合法网址" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, message: "须以 https:// 开头" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "不要把令牌写进地址" };
  }
  if (url.hash || /[\s"'`]/.test(trimmed)) {
    return { ok: false, message: "地址不能带空格、引号或 #" };
  }
  const host = url.hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) {
    return { ok: false, message: "缺少主机名" };
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "169.254.169.254"
  ) {
    return { ok: false, message: "不能指向本机" };
  }
  if (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return { ok: false, message: "不能指向私网" };
  }
  return { ok: true, normalized: trimmed.replace(/\/+$/, "") };
}

/**
 * @param {string | undefined} providerRaw
 */
export function authorityProviderUsesStoredKey(providerRaw) {
  const raw = (providerRaw ?? "").trim().toLowerCase();
  return (
    raw === "pkulaw" ||
    raw === "pku" ||
    raw === "法宝" ||
    raw === "generic" ||
    raw === "http" ||
    raw === "rest" ||
    raw === "lexis" ||
    raw === "lexisnexis"
  );
}

/**
 * @param {{
 *   provider?: string;
 *   lawEndpoint?: string;
 *   caseEndpoint?: string;
 *   apiKey?: string;
 *   hasExistingKey?: boolean;
 * }} input
 */
export function planAuthoritySave(input) {
  const provider = input?.provider === "open" ? "open" : input?.provider === "pkulaw" ? "pkulaw" : "";
  if (!provider) {
    return { ok: false, error: "请选择北大法宝或公开法规" };
  }
  if (provider === "open") {
    return {
      ok: true,
      provider: "open",
      assignments: { LAWMIND_AUTHORITY_PROVIDER: "open" },
      removeKeys: ["LAWMIND_AUTHORITY_ENDPOINT", "LAWMIND_PKULAW_CASE_ENDPOINT", ...MODE_ENV_KEYS],
      storeApiKey: "",
    };
  }
  const lawRaw = (input.lawEndpoint ?? "").trim() || PKULAW_DEFAULT_LAW_ENDPOINT;
  const law = validateAuthoritySetupUrl(lawRaw);
  if (!law.ok) {
    return { ok: false, error: `法规地址：${law.message}` };
  }
  const caseRaw =
    (input.caseEndpoint ?? "").trim() ||
    (endpointWantsPkulawGateway(law.normalized) ? PKULAW_DEFAULT_CASE_ENDPOINT : law.normalized);
  const caseUrl = validateAuthoritySetupUrl(caseRaw);
  if (!caseUrl.ok) {
    return { ok: false, error: `案例地址：${caseUrl.message}` };
  }
  const pasted = (input.apiKey ?? "").trim();
  if (!pasted && !input.hasExistingKey) {
    return { ok: false, error: "请填写北大法宝访问令牌" };
  }
  const gateway =
    endpointWantsPkulawGateway(law.normalized) || endpointWantsPkulawGateway(caseUrl.normalized);
  /** @type {Record<string, string>} */
  const assignments = {
    LAWMIND_AUTHORITY_PROVIDER: "pkulaw",
    LAWMIND_AUTHORITY_ENDPOINT: law.normalized,
    LAWMIND_PKULAW_CASE_ENDPOINT: caseUrl.normalized,
  };
  /** @type {string[]} */
  const removeKeys = [];
  if (gateway) {
    assignments.LAWMIND_PKULAW_MODE = "mcp_tools_call";
    assignments.LAWMIND_PKULAW_MCP_LAW_TOOL = "search_article";
    assignments.LAWMIND_PKULAW_MCP_CASE_TOOL = "search_case";
  } else {
    removeKeys.push(...MODE_ENV_KEYS);
  }
  return {
    ok: true,
    provider: "pkulaw",
    assignments,
    removeKeys,
    storeApiKey: pasted,
  };
}

/**
 * 钥匙串可用时令牌仍只进钥匙串，并在落盘后从 env 抹掉明文。
 * 新鲜克隆经常没有可用钥匙串（Linux 无密钥环，或 macOS 在窗口出现前
 * 第一次访问被系统拒绝并缓存为不可用）。这时模型 Key 仍能写入本机配置，
 * 法宝令牌也写入用户数据目录里的 `.env.lawmind`，否则设置页只能报
 * 「无法安全保存」而接不上。该文件不在仓库里。
 *
 * @param {ReturnType<typeof planAuthoritySave>} plan
 * @param {{ keychainAvailable?: boolean }} options
 */
export function placeAuthorityApiKey(plan, options) {
  if (!plan?.ok || plan.provider !== "pkulaw") {
    return plan;
  }
  if (options?.keychainAvailable) {
    return plan;
  }
  const pasted = (plan.storeApiKey || "").trim();
  if (!pasted) {
    return plan;
  }
  return {
    ...plan,
    storeApiKey: "",
    assignments: {
      ...plan.assignments,
      [AUTHORITY_API_KEY_ENV]: pasted,
    },
  };
}
