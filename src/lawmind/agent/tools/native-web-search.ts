/**
 * Provider-native public web search using the lawyer's configured chat model.
 *
 * DeepSeek: Responses API `tools: [{ type: "web_search" }]` (same API key as chat).
 * DashScope/Qwen: `enable_search` on chat/completions (same API key as chat).
 *
 * This is not a second model. Brave remains an optional fallback when the
 * current model has no vendor web-search tool.
 */

import { DEEPSEEK_FLASH_RETIRED_ALIASES } from "../../models/catalog.js";
import { inferProviderIdFromBaseUrl, normalizeModelBaseUrl } from "../../models/providers.js";
import { createOutboundProxy } from "../../platform/outbound-proxy.js";

export type NativeWebSearchKind = "deepseek-responses" | "dashscope-enable-search";

export type NativeWebHit = {
  title: string;
  url: string;
  description: string;
};

export type WebSearchModelRef = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

const nativeSearchProxy = createOutboundProxy({ requestTag: "web-search-native" });

const DEEPSEEK_FLASH_NAMES = new Set<string>(["deepseek-flash", ...DEEPSEEK_FLASH_RETIRED_ALIASES]);

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function hostnameOf(baseUrl: string): string {
  try {
    const raw = baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`;
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function modelNameLooksDeepSeek(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("deepseek-") || DEEPSEEK_FLASH_NAMES.has(m);
}

function modelNameLooksQwen(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith("qwen") || m.startsWith("qwq");
}

export function detectNativeWebSearchKind(
  baseUrl: string,
  model: string,
): NativeWebSearchKind | null {
  const host = hostnameOf(baseUrl);
  const inferred = inferProviderIdFromBaseUrl(baseUrl);
  if (host === "api.deepseek.com" || host.endsWith(".deepseek.com") || inferred === "deepseek") {
    return modelNameLooksDeepSeek(model) ? "deepseek-responses" : null;
  }
  if (host.includes("dashscope") || host.includes("aliyuncs.com") || inferred === "dashscope") {
    return modelNameLooksQwen(model) ? "dashscope-enable-search" : null;
  }
  if (modelNameLooksDeepSeek(model)) {
    return "deepseek-responses";
  }
  if (modelNameLooksQwen(model)) {
    return "dashscope-enable-search";
  }
  return null;
}

export function originWithoutV1(baseUrl: string): string {
  const normalized = normalizeModelBaseUrl(baseUrl);
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }
  return `https://${normalized}`;
}

function collectHttpUrls(value: unknown, into: NativeWebHit[], seen: Set<string>): void {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    collectMarkdownLinkHits(value, into, seen);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectHttpUrls(item, into, seen);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const rec = value as Record<string, unknown>;
  const urlCandidate =
    (typeof rec.url === "string" && rec.url) || (typeof rec.uri === "string" && rec.uri) || "";
  const title =
    (typeof rec.title === "string" && rec.title) ||
    (typeof rec.name === "string" && rec.name) ||
    (typeof rec.site_name === "string" && rec.site_name) ||
    "";
  const description =
    (typeof rec.description === "string" && rec.description) ||
    (typeof rec.snippet === "string" && rec.snippet) ||
    (typeof rec.excerpt === "string" && rec.excerpt) ||
    (typeof rec.text === "string" && rec.text) ||
    "";
  if (/^https?:\/\//i.test(urlCandidate.trim())) {
    addHit(into, seen, title, urlCandidate, description);
  }
  if (rec.type === "url_citation" && typeof rec.url === "string") {
    addHit(into, seen, title, rec.url, description);
  }
  for (const [key, child] of Object.entries(rec)) {
    if (key === "url" || key === "uri") {
      continue;
    }
    collectHttpUrls(child, into, seen);
  }
}

function isPublicPageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "api.deepseek.com" || host === "api.openai.com") {
      return false;
    }
    if (host.includes("aliyuncs.com") && parsed.pathname.includes("compatible-mode")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function addHit(
  into: NativeWebHit[],
  seen: Set<string>,
  title: string,
  url: string,
  description: string,
): void {
  const href = url.trim().slice(0, 2000);
  if (!href || seen.has(href) || !isPublicPageUrl(href)) {
    return;
  }
  seen.add(href);
  into.push({
    title: (title.trim() || href).slice(0, 400),
    url: href,
    description: description.replace(/\s+/g, " ").trim().slice(0, 800),
  });
}

const MD_LINK_RE = /\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/gi;

export function collectMarkdownLinkHits(
  text: string,
  into: NativeWebHit[] = [],
  seen: Set<string> = new Set(),
): NativeWebHit[] {
  MD_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MD_LINK_RE.exec(text)) !== null) {
    addHit(into, seen, match[1] ?? "", match[2] ?? "", "");
  }
  return into;
}

export function extractNativeWebHits(payload: unknown, count: number): NativeWebHit[] {
  const hits: NativeWebHit[] = [];
  const seen = new Set<string>();
  collectHttpUrls(payload, hits, seen);
  if (hits.length === 0 && payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    const textBits: string[] = [];
    if (typeof rec.output_text === "string") {
      textBits.push(rec.output_text);
    }
    collectHttpUrls(rec.choices, hits, seen);
    if (hits.length === 0) {
      collectMarkdownLinkHits(textBits.join("\n"), hits, seen);
    }
  }
  return hits.slice(0, Math.max(1, count));
}

function deepseekModelCandidates(model: string): string[] {
  const raw = model.trim();
  const lower = raw.toLowerCase();
  const out = [raw];
  if (lower === "deepseek-flash") {
    out.push("deepseek-v4-flash");
  }
  if (DEEPSEEK_FLASH_NAMES.has(lower) && lower !== "deepseek-flash") {
    out.push("deepseek-flash");
  }
  return [...new Set(out)];
}

async function readErrorSnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 280);
  } catch {
    return "";
  }
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternal = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onExternal, { once: true });
    }
  }
  try {
    return await nativeSearchProxy.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternal);
  }
}

async function searchDeepSeekResponses(
  cfg: WebSearchModelRef,
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<NativeWebHit[]> {
  const timeoutMs = Math.max(cfg.timeoutMs ?? 60_000, 45_000);
  const url = `${originWithoutV1(cfg.baseUrl)}/responses`;
  const instructions =
    "根据网页检索结果列出可核对来源。每条需要标题与 http(s) URL。没有检索到就说没有，不要猜测冠军、获奖者或新闻事实。";
  let lastErr = "DeepSeek 网页检索失败";
  for (const model of deepseekModelCandidates(cfg.model)) {
    const res = await postJson(
      url,
      cfg.apiKey,
      {
        model,
        instructions,
        input: query,
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
        max_output_tokens: 2048,
      },
      signal,
      timeoutMs,
    );
    if (res.ok) {
      const payload: unknown = await res.json();
      return extractNativeWebHits(payload, count);
    }
    const snippet = await readErrorSnippet(res);
    lastErr = `DeepSeek 网页检索失败: HTTP ${res.status}${snippet ? ` ${snippet}` : ""}`;
    if (res.status !== 400) {
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr);
}

async function searchDashScopeEnableSearch(
  cfg: WebSearchModelRef,
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<NativeWebHit[]> {
  const timeoutMs = Math.max(cfg.timeoutMs ?? 60_000, 45_000);
  const url = `${trimSlash(cfg.baseUrl)}/chat/completions`;
  const res = await postJson(
    url,
    cfg.apiKey,
    {
      model: cfg.model,
      messages: [
        {
          role: "system",
          content:
            "根据联网检索结果作答。列出标题与 URL。没有检索到就说没有，不要猜测冠军或获奖者。",
        },
        { role: "user", content: query },
      ],
      enable_search: true,
      temperature: 0.1,
    },
    signal,
    timeoutMs,
  );
  if (!res.ok) {
    const snippet = await readErrorSnippet(res);
    throw new Error(`通义网页检索失败: HTTP ${res.status}${snippet ? ` ${snippet}` : ""}`);
  }
  const payload: unknown = await res.json();
  return extractNativeWebHits(payload, count);
}

export async function runNativeWebSearch(
  cfg: WebSearchModelRef,
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<{ kind: NativeWebSearchKind; results: NativeWebHit[] }> {
  const kind = detectNativeWebSearchKind(cfg.baseUrl, cfg.model);
  if (!kind) {
    throw new Error("当前模型没有厂商网页检索");
  }
  if (!cfg.apiKey.trim()) {
    throw new Error("当前模型未配置 API Key");
  }
  const results =
    kind === "deepseek-responses"
      ? await searchDeepSeekResponses(cfg, query, count, signal)
      : await searchDashScopeEnableSearch(cfg, query, count, signal);
  return { kind, results };
}
