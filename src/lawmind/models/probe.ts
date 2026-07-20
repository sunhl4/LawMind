import type { AgentModelConfig } from "../agent/types.js";

export type ModelProbeResult =
  | { ok: true; latencyMs: number; model: string; baseUrl: string }
  | { ok: false; error: string; code: string };

/** Parse OpenAI-compatible JSON bodies that return HTTP 200 with an error payload. */
export function parseProbeErrorBody(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const body = JSON.parse(trimmed) as Record<string, unknown>;
    if (body.error) {
      const err = body.error;
      const msg =
        typeof err === "string"
          ? err
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message?: string }).message ?? "")
            : typeof err === "object" && err !== null && "msg" in err
              ? String((err as { msg?: string }).msg ?? "")
              : "";
      if (msg.trim()) {
        return msg.trim().slice(0, 280);
      }
    }
    const choices = body.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return "模型 API 返回 200 但无有效 choices，请检查模型名与 Key 权限";
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Minimal upstream reachability check (one short completion).
 */
export async function probeAgentModel(config: AgentModelConfig): Promise<ModelProbeResult> {
  if (!config.apiKey.trim()) {
    return { ok: false, code: "missing_api_key", error: "未配置 API Key" };
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = Math.min(config.timeoutMs ?? 120_000, 60_000);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      const attempted = `model="${config.model}" @ ${config.baseUrl}`;
      return {
        ok: false,
        code: "model_api_error",
        error: `HTTP ${response.status} (${attempted}): ${text.slice(0, 280)}`,
      };
    }
    const bodyErr = parseProbeErrorBody(text);
    if (bodyErr) {
      return { ok: false, code: "model_api_error", error: bodyErr };
    }
    return {
      ok: true,
      latencyMs,
      model: config.model,
      baseUrl: config.baseUrl,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = formatProbeFetchError(err, config, timeoutMs);
    const code =
      message.includes("超时") || /abort/i.test(message) ? "model_timeout" : "model_network_error";
    return { ok: false, code, error: `${message} (${latencyMs}ms)` };
  } finally {
    clearTimeout(timer);
  }
}

function formatProbeFetchError(err: unknown, config: AgentModelConfig, timeoutMs: number): string {
  if (err instanceof Error && err.name === "AbortError") {
    return `模型请求超时（${timeoutMs}ms）。请检查网络或在 .env.lawmind 中增大 LAWMIND_AGENT_TIMEOUT_MS 后重启。`;
  }
  const cause =
    err instanceof Error && "cause" in err && err.cause instanceof Error ? err.cause.message : "";
  const msg = err instanceof Error ? err.message : String(err);
  const combined = `${msg} ${cause}`.trim();
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|certificate|TLS/i.test(combined)) {
    return `无法连接模型服务（${combined}）。请确认 Base URL：${config.baseUrl}，以及本机网络/代理/防火墙。`;
  }
  return combined || "模型探测失败";
}
