/**
 * Company / 工商 lookup. No live registry adapter ships in Solo.
 * Honest failure: never stamp as verified 登记信息.
 * A configured URL is not live until a fetch actually succeeds.
 */

import { assertAuthorityEndpointSafeToFetch } from "../../../retrieval/authority-health.js";
import type { AuthorityDnsLookupFn } from "../../../retrieval/authority-url-guard.js";
import type { AgentTool } from "../../types.js";

export const SEARCH_COMPANY_REGISTRY_TOOL_NAME = "search_company_registry";

export function summarizeCompanyRegistryConfig(opts?: { url?: string }): {
  configured: boolean;
  envKey: "LAWMIND_COMPANY_REGISTRY_URL";
  message: string;
} {
  const url = (opts?.url ?? process.env.LAWMIND_COMPANY_REGISTRY_URL ?? "").trim();
  if (!url) {
    return {
      configured: false,
      envKey: "LAWMIND_COMPANY_REGISTRY_URL",
      message:
        "未接工商源。配置 LAWMIND_COMPANY_REGISTRY_URL 后才会实时查询；未成功拉取不得写成已核实登记。",
    };
  }
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  return {
    configured: true,
    envKey: "LAWMIND_COMPANY_REGISTRY_URL",
    message: host
      ? `已配置工商端点（${host}）。查询成功仍须对照公示原文，不得写成已核对股权结构。`
      : "已配置工商端点。查询成功仍须对照公示原文，不得写成已核对股权结构。",
  };
}

const FETCH_MS = 8_000;

export type CompanyRegistryLiveResult = {
  query: string;
  sourceTier: "sample" | "live";
  authorityLive: boolean;
  unverified: true;
  message: string;
  endpoint?: string;
  httpStatus?: number;
};

function missingSourceResult(
  name: string,
  allowWebSearch: boolean | undefined,
): CompanyRegistryLiveResult {
  return {
    query: name,
    sourceTier: "sample",
    authorityLive: false,
    unverified: true,
    message:
      allowWebSearch === true
        ? `未接工商源。可对「${name} 国家企业信用信息公示系统」做公开网页检索，命中仍标【待核实】，不得写成已核对股权结构。`
        : `未接工商源，无法核验「${name}」的登记状态。请律师在公示系统核对，或在输入选项打开「联网」后再查。正文标【待核实】。`,
  };
}

/** Fetch a configured 工商 adapter. Never sets authorityLive without HTTP 2xx. */
export async function fetchCompanyRegistryLive(input: {
  endpoint: string;
  name: string;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
  signal?: AbortSignal;
}): Promise<CompanyRegistryLiveResult> {
  const query = input.name;
  const safe = await assertAuthorityEndpointSafeToFetch(input.endpoint, {
    lookup: input.lookup,
  });
  if (!safe.ok) {
    return {
      query,
      sourceTier: "sample",
      authorityLive: false,
      unverified: true,
      message: `工商源地址不可用（${safe.message}）。不得写成已核实登记信息。请律师在公示系统核对「${query}」。`,
      endpoint: input.endpoint,
    };
  }
  const url = new URL(safe.normalized);
  url.searchParams.set("q", query);
  const headers: Record<string, string> = { Accept: "application/json, text/plain" };
  const key = process.env.LAWMIND_COMPANY_REGISTRY_KEY?.trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(FETCH_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  try {
    const res = await fetchImpl(url.toString(), { method: "GET", headers, signal });
    if (!res.ok) {
      return {
        query,
        sourceTier: "sample",
        authorityLive: false,
        unverified: true,
        message: `工商源返回 HTTP ${res.status}，未核验「${query}」。不得写成已核实登记信息。`,
        endpoint: safe.normalized,
        httpStatus: res.status,
      };
    }
    return {
      query,
      sourceTier: "live",
      authorityLive: true,
      unverified: true,
      message: `已查询工商源（HTTP ${res.status}），仍须对照公示原文核验「${query}」，不得写成已核对股权结构。`,
      endpoint: safe.normalized,
      httpStatus: res.status,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      query,
      sourceTier: "sample",
      authorityLive: false,
      unverified: true,
      message: `工商源请求失败（${err.slice(0, 120)}）。未核验「${query}」，不得写成已核实登记信息。`,
      endpoint: safe.normalized,
    };
  }
}

export const searchCompanyRegistry: AgentTool = {
  definition: {
    name: SEARCH_COMPANY_REGISTRY_TOOL_NAME,
    description:
      "查询企业登记信息（名称、统一社会信用代码、状态）。未接工商源时诚实说明，不得写成已核实股权或权利稳定性。联网开启时可建议用公开网页交叉核。",
    category: "search",
    parameters: {
      name: {
        type: "string",
        description: "企业名称或统一社会信用代码",
        required: true,
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (name.length < 2) {
      return { ok: false, error: "请提供企业名称或统一社会信用代码。" };
    }
    const liveAdapter = process.env.LAWMIND_COMPANY_REGISTRY_URL?.trim();
    if (!liveAdapter) {
      return {
        ok: true,
        data: missingSourceResult(name, ctx.allowWebSearch),
      };
    }
    const data = await fetchCompanyRegistryLive({
      endpoint: liveAdapter,
      name,
      signal: ctx.abortSignal,
    });
    return { ok: true, data };
  },
};
