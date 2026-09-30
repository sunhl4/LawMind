/** True when the upstream OpenAI-compatible provider rejected or failed the request. */
export function isModelProviderErrorMessage(message: string): boolean {
  const m = message.trim();
  return (
    m.startsWith("Model API error") ||
    /model api error/i.test(m) ||
    m.startsWith("Model network error") ||
    m.startsWith("Model request timed out") ||
    m.includes("AbortError") ||
    /aborted/i.test(m) ||
    /request timed out/i.test(m) ||
    /fetch failed/i.test(m)
  );
}

function providerCodeFromRaw(raw: string): string | undefined {
  const m = raw.trim();
  if (/Arrearage|overdue-payment/i.test(m)) {
    return "Arrearage";
  }
  const jsonStart = m.indexOf("{");
  if (jsonStart < 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(m.slice(jsonStart)) as {
      error?: { code?: string; type?: string };
      code?: string;
    };
    const code = parsed?.error?.code ?? parsed?.error?.type ?? parsed?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

const NO_NETWORK = "没有网络，连不上模型。请检查本机网络后再试。";
const BILLING_OR_NETWORK = "这一轮没能调用模型。请检查是不是没有网络，或账户是否欠费，然后再试。";

function isNoNetworkFailure(m: string): boolean {
  return (
    m.startsWith("Model network error") ||
    /fetch failed/i.test(m) ||
    /ENOTFOUND|EAI_AGAIN|getaddrinfo|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(
      m,
    ) ||
    /DNS 解析失败|DNS 无解析/.test(m)
  );
}

/** User-facing copy for model/provider failures — never return raw JSON or request_id blobs. */
export function friendlyModelErrorMessage(raw: string): string {
  const m = raw.trim();
  if (!m) {
    return "模型暂时不可用，请稍后重试。";
  }

  const providerCode = providerCodeFromRaw(m);
  if (providerCode === "Arrearage" || /Access denied.*good standing/i.test(m)) {
    return "模型账户欠费，这一轮没能调用。请到服务商充值后再试。";
  }
  if (providerCode === "InvalidApiKey" || providerCode === "invalid_api_key") {
    return "密钥无效。请在设置里打开连接向导，检查并更新。";
  }
  if (/Invalid API-key|invalid api key|incorrect api key/i.test(m)) {
    return "密钥无效或已过期。请在设置里打开连接向导，更新后再试。";
  }
  if (/insufficient_quota|quota|rate limit|429/i.test(m) || providerCode === "Throttling") {
    return "请求过于频繁或额度已用尽。请稍后再试，或到服务商查看用量与余额。";
  }
  if (/model not found|does not exist|Unknown model/i.test(m)) {
    return "当前所选模型不可用或未开通。请在设置中更换模型，或在服务商开通对应模型。";
  }

  if (
    m.includes("AbortError") ||
    /aborted/i.test(m) ||
    /timed out/i.test(m) ||
    m.startsWith("Model request timed out")
  ) {
    return "网络不通或太慢，请求超时了。请检查网络后再试。";
  }

  if (isNoNetworkFailure(m)) {
    if (/certificate|TLS|CERT_/i.test(m)) {
      return "网络证书没通过，连不上模型。请检查本机时间或公司网络后再试。";
    }
    return NO_NETWORK;
  }

  if (/^model call failed$/i.test(m) || /empty response from model/i.test(m)) {
    return "模型没有返回内容。请稍后重试。";
  }

  if (m.startsWith("Model API error") || /model api error/i.test(m)) {
    const status = Number(/Model API error (\d+)/i.exec(m)?.[1] ?? 0);
    if (status === 401 || status === 403) {
      return "密钥没有被服务商接受。请检查密钥是否有效，以及账户是否正常。";
    }
    if (status === 402) {
      return "模型账户欠费。请到服务商充值后再试。";
    }
    if (status === 429) {
      return "请求过于频繁或额度已用尽。请稍后再试，或到服务商查看用量与余额。";
    }
    if (status >= 500) {
      return "模型服务商暂时异常，请稍后重试或更换模型。";
    }
    return BILLING_OR_NETWORK;
  }

  if (m.length > 120 || m.includes("{") || /request_id|chatcmpl-/i.test(m)) {
    return BILLING_OR_NETWORK;
  }

  return m;
}

const RAW_MODEL_FAILURE_DUMP =
  /^(?:本轮模型调用失败|Model network error|Model API error|Model request timed out|Model call failed)\b/;

/**
 * 已落盘的助手气泡里可能还是原始报错。只改写这种原文，普通答复原样留下。
 */
export function surfaceModelFailureForLawyer(text: string): string {
  const m = text.trim();
  if (!m) {
    return m;
  }
  if (RAW_MODEL_FAILURE_DUMP.test(m) || /getaddrinfo|ENOTFOUND/.test(m) || /DNS 解析失败/.test(m)) {
    return friendlyModelErrorMessage(m);
  }
  return m;
}
