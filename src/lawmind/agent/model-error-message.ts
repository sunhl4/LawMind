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

/** User-facing copy for model/provider failures — never return raw JSON or request_id blobs. */
export function friendlyModelErrorMessage(raw: string): string {
  const m = raw.trim();
  if (!m) {
    return "模型暂时不可用，请稍后重试。";
  }

  const providerCode = providerCodeFromRaw(m);
  if (providerCode === "Arrearage" || /Access denied.*good standing/i.test(m)) {
    return "模型服务账户欠费或已停用。请到模型服务商控制台（如阿里云百炼）查看余额与账单，完成充值后再试。";
  }
  if (providerCode === "InvalidApiKey" || providerCode === "invalid_api_key") {
    return "API Key 无效。请在设置 → API 配置向导中检查并更新密钥。";
  }
  if (/Invalid API-key|invalid api key|incorrect api key/i.test(m)) {
    return "API Key 无效或已过期。请在设置 → API 配置向导中更新密钥。";
  }
  if (/insufficient_quota|quota|rate limit|429/i.test(m) || providerCode === "Throttling") {
    return "请求过于频繁或额度已用尽。请稍后再试，或到服务商控制台查看用量与余额。";
  }
  if (/model not found|does not exist|Unknown model/i.test(m)) {
    return "当前所选模型不可用或未开通。请在设置中更换模型，或在服务商控制台开通对应模型。";
  }

  if (
    m.includes("AbortError") ||
    /aborted/i.test(m) ||
    /timed out/i.test(m) ||
    m.startsWith("Model request timed out")
  ) {
    return "模型请求超时。请检查网络连接，或稍后重试。";
  }

  if (m.startsWith("Model network error") || /fetch failed/i.test(m)) {
    return "无法连接模型服务。请检查 Base URL、本机网络/代理，或在设置 → 模型与 API 中测试连接。";
  }

  if (m.startsWith("Model API error") || /model api error/i.test(m)) {
    const status = Number(/Model API error (\d+)/i.exec(m)?.[1] ?? 0);
    if (status === 401 || status === 403) {
      return "API 认证失败。请检查 API Key 是否有效，以及服务商账户是否正常。";
    }
    if (status === 402 || status === 429) {
      return "账户额度不足或请求受限。请检查服务商余额、账单或限流策略。";
    }
    if (status >= 500) {
      return "模型服务商暂时异常，请稍后重试或更换模型。";
    }
    return "模型暂时不可用。请检查 API Key、账户状态与网络连接。";
  }

  if (m.length > 120 || m.includes("{") || /request_id|chatcmpl-/i.test(m)) {
    return "模型暂时不可用。请检查 API Key、账户状态与网络连接。";
  }

  return m;
}
