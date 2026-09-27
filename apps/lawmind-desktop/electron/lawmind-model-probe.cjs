"use strict";

/**
 * Minimal model reachability probe for the Electron main process.
 * Keep in sync with `src/lawmind/models/probe.ts`.
 *
 * 为什么这份镜像**不能**删掉、也不能改成「统一走 /api/models/test」：
 * 它是 `saveSetup` 的**写入前**预检——此时新 Key 还没写进 `.env.lawmind`、后端也还没
 * 带着新配置重启，`/api/models/test` 探到的只会是**旧**配置（或首次运行时根本没有服务）。
 * 写入后再探（`postLocalModelTest`）是第二阶段，两者不是重复，是两个检查点。
 *
 * `parseProbeErrorBody` 是两份实现里**语义必须一致**的那部分（HTTP 200 却带 error
 * 载荷的 OpenAI 兼容返回），漂移守卫见 `lawmind-model-probe.test.ts`。
 */

/**
 * @param {{ apiKey: string; baseUrl: string; model: string; timeoutMs?: number }} config
 * @returns {Promise<{ ok: true; latencyMs: number } | { ok: false; code: string; error: string }>}
 */
async function probeModelInline(config) {
  const apiKey = (config.apiKey ?? "").trim();
  if (!apiKey) {
    return { ok: false, code: "missing_api_key", error: "还没填写模型密钥" };
  }
  const baseUrl = (config.baseUrl ?? "").trim().replace(/\/$/, "");
  const model = (config.model ?? "").trim();
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
      const auth = isModelAuthFailureStatus(response.status, text);
      return {
        ok: false,
        code: auth ? "invalid_api_key" : "model_api_error",
        error: auth
          ? "密钥无效或已过期。本机存过密钥不等于服务商接受。请到服务商重新生成，再用「连接向导」粘贴。"
          : `HTTP ${response.status}: ${text.slice(0, 280)}`,
      };
    }
    const bodyErr = parseProbeErrorBody(text);
    if (bodyErr) {
      const auth = isModelAuthFailureStatus(200, bodyErr);
      return {
        ok: false,
        code: auth ? "invalid_api_key" : "model_api_error",
        error: auth
          ? "密钥无效或已过期。本机存过密钥不等于服务商接受。请到服务商重新生成，再用「连接向导」粘贴。"
          : bodyErr,
      };
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
function isModelAuthFailureStatus(status, body) {
  if (status === 401 || status === 403) {
    return true;
  }
  return /authentication fails|invalid.*api.?key|incorrect api key|unauthorized/i.test(body);
}

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

module.exports = { probeModelInline, parseProbeErrorBody };
