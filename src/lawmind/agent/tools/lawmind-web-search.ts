/**
 * LawMind 公开网页检索。
 *
 * 默认用当前对话模型的厂商网页检索（DeepSeek Responses / 通义 enable_search），
 * 与设置里「检索与对话共用同一模型」同一套 Key。关掉共用且法律垂类自带厂商联网时，才改走垂类。Brave 只是当前模型没有厂商检索时的可选备用。
 *
 * 可选环境变量（Brave 备用）：
 * - LAWMIND_WEB_SEARCH_API_KEY
 * - BRAVE_API_KEY
 */

import { LAWMIND_DEFAULT_UPSTREAM_MODEL } from "../../models/catalog.js";
import { getProviderDefinition, resolveProviderApiKeyFromEnv } from "../../models/providers.js";
import {
  retrievalModeIsDual,
  resolveLegalRetrievalModelFromStore,
} from "../../models/retrieval-split.js";
import { createOutboundProxy } from "../../platform/outbound-proxy.js";
import { resolveEdition } from "../../policy/edition.js";
import { checkNetworkAllowlist, hostnameFromUrl } from "../../policy/network-allowlist.js";
import { readWorkspacePolicyFile } from "../../policy/workspace-policy.js";
import { friendlyModelErrorMessage } from "../model-error-message.js";
import type { AgentTool } from "../types.js";
import {
  detectNativeWebSearchKind,
  runNativeWebSearch,
  type NativeWebSearchKind,
  type WebSearchModelRef,
} from "./native-web-search.js";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const webSearchProxy = createOutboundProxy({ requestTag: "web-search" });

export type PublicWebHit = { title: string; url: string; description: string };

export type PublicWebSearchProvider = "deepseek" | "dashscope" | "brave";

export type PublicWebSearchResult = {
  provider: PublicWebSearchProvider;
  results: PublicWebHit[];
};

export type PublicWebSearchBackend =
  | { kind: "native"; nativeKind: NativeWebSearchKind; model: WebSearchModelRef }
  | { kind: "brave" }
  | { kind: "none" };

export function resolveLawMindWebSearchApiKey(): string | undefined {
  const a = process.env.LAWMIND_WEB_SEARCH_API_KEY?.trim();
  const b = process.env.BRAVE_API_KEY?.trim();
  return a || b || undefined;
}

export function resolveChatWebSearchModel(
  override?: WebSearchModelRef | null,
): WebSearchModelRef | null {
  if (override?.apiKey?.trim() && override.baseUrl?.trim() && override.model?.trim()) {
    return {
      baseUrl: override.baseUrl.trim(),
      apiKey: override.apiKey.trim(),
      model: override.model.trim(),
      timeoutMs: override.timeoutMs,
    };
  }
  const timeoutRaw = process.env.LAWMIND_AGENT_TIMEOUT_MS?.trim() ?? "";
  const parsedTimeout = Number(timeoutRaw);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.floor(parsedTimeout) : 120_000;

  const agentKey = process.env.LAWMIND_AGENT_API_KEY?.trim();
  const agentModel =
    process.env.LAWMIND_AGENT_MODEL?.trim() ||
    process.env.LAWMIND_DEEPSEEK_MODEL?.trim() ||
    process.env.LAWMIND_QWEN_MODEL?.trim();
  const agentBase =
    process.env.LAWMIND_AGENT_BASE_URL?.trim() || process.env.LAWMIND_QWEN_BASE_URL?.trim();
  if (agentKey && agentModel) {
    return {
      baseUrl: agentBase || getProviderDefinition("deepseek").defaultBaseUrl,
      apiKey: agentKey,
      model: agentModel,
      timeoutMs,
    };
  }

  const deepseekKey = resolveProviderApiKeyFromEnv("deepseek");
  if (deepseekKey) {
    return {
      baseUrl: getProviderDefinition("deepseek").defaultBaseUrl,
      apiKey: deepseekKey,
      model: process.env.LAWMIND_DEEPSEEK_MODEL?.trim() || LAWMIND_DEFAULT_UPSTREAM_MODEL,
      timeoutMs,
    };
  }

  const qwenKey = resolveProviderApiKeyFromEnv("dashscope");
  if (qwenKey) {
    return {
      baseUrl:
        process.env.LAWMIND_QWEN_BASE_URL?.trim() ||
        getProviderDefinition("dashscope").defaultBaseUrl,
      apiKey: qwenKey,
      model: process.env.LAWMIND_QWEN_MODEL?.trim() || "qwen-plus",
      timeoutMs,
    };
  }
  return null;
}

export function resolvePublicWebSearchBackend(
  override?: WebSearchModelRef | null,
): PublicWebSearchBackend {
  const model = resolveChatWebSearchModel(override);
  if (model) {
    const nativeKind = detectNativeWebSearchKind(model.baseUrl, model.model);
    if (nativeKind) {
      return { kind: "native", nativeKind, model };
    }
  }
  if (resolveLawMindWebSearchApiKey()) {
    return { kind: "brave" };
  }
  return { kind: "none" };
}

export function isPublicWebSearchReady(override?: WebSearchModelRef | null): boolean {
  return resolvePublicWebSearchBackend(override).kind !== "none";
}

/**
 * Dual retrieval: if the dedicated legal model has vendor web search, use it
 * for 联网. Otherwise keep the chat/reasoning model (DeepSeek Flash etc.).
 */
export function pickWebSearchModel(
  chat: WebSearchModelRef | null | undefined,
  lawMindRoot?: string,
): WebSearchModelRef | null {
  const chatRef = resolveChatWebSearchModel(chat ?? null);
  if (!lawMindRoot || !retrievalModeIsDual()) {
    return chatRef;
  }
  const legal = resolveLegalRetrievalModelFromStore(lawMindRoot);
  if (legal && detectNativeWebSearchKind(legal.baseUrl, legal.model)) {
    return {
      baseUrl: legal.baseUrl,
      apiKey: legal.apiKey,
      model: legal.model,
      timeoutMs: legal.timeoutMs,
    };
  }
  return chatRef;
}

export const PUBLIC_WEB_SEARCH_UNAVAILABLE =
  "当前对话模型没有厂商网页检索，也未配置可选的 Brave 密钥。DeepSeek Flash / 通义开「联网」后用同一套 Key 搜网页，不必再配第二个模型。";

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveWebResponse = {
  web?: { results?: BraveWebResult[] };
};

export function assertBraveSearchNetworkAllowed(workspaceDir: string): string | null {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const edition = resolveEdition({ policy }).edition;
  const host = hostnameFromUrl(BRAVE_SEARCH_ENDPOINT);
  if (!host) {
    return "无法解析联网检索端点主机名。";
  }
  const check = checkNetworkAllowlist({ policy, edition, hostname: host });
  return check.allowed ? null : (check.reason ?? "联网检索被工作区策略禁止。");
}

export async function lawMindBraveWebSearch(
  query: string,
  count: number,
  workspaceDir?: string,
  signal?: AbortSignal,
): Promise<PublicWebHit[]> {
  const apiKey = resolveLawMindWebSearchApiKey();
  if (!apiKey) {
    throw new Error("missing web search API key");
  }
  if (workspaceDir?.trim()) {
    const blocked = assertBraveSearchNetworkAllowed(workspaceDir.trim());
    if (blocked) {
      throw new Error(blocked);
    }
  }
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await webSearchProxy.fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave Search API error ${res.status}: ${text.slice(0, 280)}`);
  }

  const data = (await res.json()) as BraveWebResponse;
  const rows = Array.isArray(data.web?.results) ? data.web.results : [];
  return rows.slice(0, count).map((r) => ({
    title: (r.title ?? "").trim().slice(0, 400),
    url: (r.url ?? "").trim().slice(0, 2000),
    description: (r.description ?? "").trim().slice(0, 800),
  }));
}

function nativeKindToProvider(kind: NativeWebSearchKind): PublicWebSearchProvider {
  return kind === "dashscope-enable-search" ? "dashscope" : "deepseek";
}

export async function lawMindPublicWebSearch(
  query: string,
  count: number,
  workspaceDir?: string,
  signal?: AbortSignal,
  model?: WebSearchModelRef | null,
): Promise<PublicWebSearchResult> {
  const backend = resolvePublicWebSearchBackend(model);
  if (backend.kind === "native") {
    try {
      const native = await runNativeWebSearch(backend.model, query, count, signal);
      return { provider: nativeKindToProvider(native.kind), results: native.results };
    } catch (err) {
      if (resolveLawMindWebSearchApiKey()) {
        const results = await lawMindBraveWebSearch(query, count, workspaceDir, signal);
        return { provider: "brave", results };
      }
      throw err;
    }
  }
  if (backend.kind === "brave") {
    const results = await lawMindBraveWebSearch(query, count, workspaceDir, signal);
    return { provider: "brave", results };
  }
  throw new Error(PUBLIC_WEB_SEARCH_UNAVAILABLE);
}

export const lawMindWebSearchTool: AgentTool = {
  definition: {
    name: "web_search",
    description:
      "在互联网上检索公开网页摘要。默认使用当前对话模型的厂商网页检索（与聊天同一套 Key）；若设置里关掉「共用」且法律垂类自带厂商联网，则改走垂类。仅当该模型没有厂商检索时才用可选的 Brave。须在本轮开启「联网」。引用前请交叉验证，不可替代官方法规或裁判文书。",
    category: "search",
    isConcurrencySafe: true,
    parameters: {
      query: { type: "string", description: "搜索关键词或问题", required: true },
      count: { type: "number", description: "返回条数 1-10，默认 5" },
    },
  },
  async execute(params, ctx) {
    if (!ctx.allowWebSearch) {
      return {
        ok: false,
        error:
          "对话栏「联网」未开启：请在输入选项里把「联网」改成开启后再调用 web_search。list_more_tools 不能代替该开关。未开启时仅可使用工作区与本地检索工具。",
      };
    }
    if (!isPublicWebSearchReady(ctx.webSearchModel)) {
      return {
        ok: false,
        error: PUBLIC_WEB_SEARCH_UNAVAILABLE,
      };
    }
    const rawQuery = params.query;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const raw =
      typeof params.count === "number" && Number.isFinite(params.count) ? params.count : 5;
    const count = Math.min(10, Math.max(1, Math.floor(raw)));
    try {
      const found = await lawMindPublicWebSearch(
        query,
        count,
        ctx.workspaceDir,
        ctx.abortSignal,
        ctx.webSearchModel,
      );
      return {
        ok: true,
        data: {
          query,
          provider: found.provider,
          results: found.results,
          note: "网页摘要仅供参考，重要事实请核对原始来源。",
        },
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: friendlyModelErrorMessage(
          rawMsg.startsWith("联网检索失败") ? rawMsg : `联网检索失败: ${rawMsg}`,
        ),
      };
    }
  },
};
