/**
 * Minimal OpenAI-compatible JSON chat completion helper (LawMind internal).
 * Used by model-driven router / reasoning when retrieval adapters are not involved.
 */

export type OpenAiJsonClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
};

type ChatRole = "system" | "user";

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Call /v1/chat/completions with response_format json_object; return parsed JSON or null.
 */
export async function completeJsonObject<T>(
  cfg: OpenAiJsonClientConfig,
  messages: Array<{ role: ChatRole; content: string }>,
): Promise<T | null> {
  const timeoutMs = cfg.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature ?? 0.1,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return null;
    }

    return safeJsonParse<T>(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function routerLlmConfigFromEnv(): OpenAiJsonClientConfig | null {
  const baseUrl =
    process.env.LAWMIND_ROUTER_BASE_URL ??
    process.env.LAWMIND_AGENT_BASE_URL ??
    process.env.QWEN_BASE_URL;
  const apiKey =
    process.env.LAWMIND_ROUTER_API_KEY ??
    process.env.LAWMIND_AGENT_API_KEY ??
    process.env.QWEN_API_KEY;
  const model =
    process.env.LAWMIND_ROUTER_MODEL ?? process.env.LAWMIND_AGENT_MODEL ?? process.env.QWEN_MODEL;
  if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    temperature: process.env.LAWMIND_ROUTER_TEMPERATURE
      ? Number(process.env.LAWMIND_ROUTER_TEMPERATURE)
      : 0.1,
    timeoutMs: process.env.LAWMIND_ROUTER_TIMEOUT_MS
      ? Number(process.env.LAWMIND_ROUTER_TIMEOUT_MS)
      : 45_000,
  };
}

export function reasoningLlmConfigFromEnv(): OpenAiJsonClientConfig | null {
  const baseUrl =
    process.env.LAWMIND_REASONING_BASE_URL ??
    process.env.LAWMIND_AGENT_BASE_URL ??
    process.env.QWEN_BASE_URL;
  const apiKey =
    process.env.LAWMIND_REASONING_API_KEY ??
    process.env.LAWMIND_AGENT_API_KEY ??
    process.env.QWEN_API_KEY;
  const model =
    process.env.LAWMIND_REASONING_MODEL ??
    process.env.LAWMIND_AGENT_MODEL ??
    process.env.QWEN_MODEL;
  if (!baseUrl?.trim() || !apiKey?.trim() || !model?.trim()) {
    return null;
  }
  return {
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    temperature: process.env.LAWMIND_REASONING_TEMPERATURE
      ? Number(process.env.LAWMIND_REASONING_TEMPERATURE)
      : 0.2,
    timeoutMs: process.env.LAWMIND_REASONING_TIMEOUT_MS
      ? Number(process.env.LAWMIND_REASONING_TIMEOUT_MS)
      : 90_000,
  };
}
