"use strict";

/**
 * Minimal model reachability probe for the Electron main process.
 * Keep in sync with `src/lawmind/models/probe.ts`.
 */

/**
 * @param {{ apiKey: string; baseUrl: string; model: string; timeoutMs?: number }} config
 * @returns {Promise<{ ok: true; latencyMs: number } | { ok: false; code: string; error: string }>}
 */
async function probeModelInline(config) {
  const apiKey = String(config.apiKey ?? "").trim();
  if (!apiKey) {
    return { ok: false, code: "missing_api_key", error: "未配置 API Key" };
  }
  const baseUrl = String(config.baseUrl ?? "").trim().replace(/\/$/, "");
  const model = String(config.model ?? "").trim();
  if (!baseUrl || !model) {
    return { ok: false, code: "invalid_config", error: "Base URL 与模型名不能为空" };
  }
  const timeoutMs = Math.min(Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 60_000, 60_000);
  const url = `${baseUrl}/chat/completions`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        code: "model_api_error",
        error: `HTTP ${response.status}: ${text.slice(0, 280)}`,
      };
    }
    const bodyErr = parseProbeErrorBody(text);
    if (bodyErr) {
      return { ok: false, code: "model_api_error", error: bodyErr };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = formatProbeFetchError(err, baseUrl, timeoutMs);
    const code =
      message.includes("超时") || /abort/i.test(message) ? "model_timeout" : "model_network_error";
    return { ok: false, code, error: `${message} (${latencyMs}ms)` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function parseProbeErrorBody(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const body = JSON.parse(trimmed);
    if (body && typeof body === "object") {
      if (body.error) {
        const err = body.error;
        const msg =
          typeof err === "string"
            ? err
            : typeof err?.message === "string"
              ? err.message
              : typeof err?.msg === "string"
                ? err.msg
                : "";
        if (msg.trim()) {
          return msg.trim().slice(0, 280);
        }
      }
      const choices = body.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        return "模型 API 返回 200 但无有效 choices，请检查模型名与 Key 权限";
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {unknown} err
 * @param {string} baseUrl
 * @param {number} timeoutMs
 */
function formatProbeFetchError(err, baseUrl, timeoutMs) {
  if (err instanceof Error && err.name === "AbortError") {
    return `模型请求超时（${timeoutMs}ms）。请检查网络或在 .env.lawmind 中增大 LAWMIND_AGENT_TIMEOUT_MS 后重启。`;
  }
  const cause =
    err instanceof Error && "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${cause}`.trim();
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS/i.test(combined)) {
    return `无法连接模型服务（${combined}）。请确认 Base URL：${baseUrl}，以及本机网络/代理/防火墙。`;
  }
  return combined || "模型探测失败";
}

module.exports = { probeModelInline };
