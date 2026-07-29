/**
 * Optional live search against 国家法律法规数据库 (flk.npc.gov.cn).
 *
 * Official public government source (not a commercial library). The site
 * migrated from GET `/api/` to POST `/law-search/search/list` (SPA). Fail-closed
 * on HTML/non-JSON or error. Prefer local corpus for reproducible OSS builds;
 * enable with LAWMIND_OPEN_LAW_NPC=1.
 *
 * USER note: respect site rate limits; do not bulk-mirror for redistribution
 * without checking current publication rules.
 */

import { validateAuthorityEndpointUrl } from "../../authority-health.js";
import type { AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { assertOpenLawLiveEndpointSafe } from "./live-endpoint.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

/** New SPA list API (POST JSON). Old GET `/api/` now returns the HTML shell. */
export const DEFAULT_NPC_FLK_LIST = "https://flk.npc.gov.cn/law-search/search/list";

const NPC_LICENSE_NOTE =
  "来源：国家法律法规数据库（flk.npc.gov.cn）官方公开检索；非正式商业库转授权";

export function isNpcFlkLiveEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OPEN_LAW_NPC ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Resolve NPC list endpoint; fail-closed if URL invalid. */
export function resolveNpcFlkEndpoint(opts?: { endpoint?: string }):
  | {
      ok: true;
      normalized: string;
    }
  | {
      ok: false;
      message: string;
    } {
  const ep = (
    opts?.endpoint ??
    process.env.LAWMIND_OPEN_LAW_NPC_ENDPOINT ??
    DEFAULT_NPC_FLK_LIST
  ).trim();
  return validateAuthorityEndpointUrl(ep);
}

type FlkListRow = {
  bbbs?: string;
  id?: string;
  title?: string;
  name?: string;
  zdjgName?: string;
  office?: string;
  gbrq?: string;
  sxrq?: string;
  sxx?: string | number;
  flxz?: string;
  status?: string | number;
  publish?: string;
  url?: string;
  score?: number;
};

function stripNpcHighlightHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .trim();
}

function mapFlxzToKind(flxz: string | undefined): AuthorityHit["kind"] {
  const t = (flxz ?? "").trim();
  if (!t) {
    return "statute";
  }
  if (/法规|条例|规章/.test(t)) {
    return "regulation";
  }
  if (/司法解释|案例|判决/.test(t)) {
    return "case";
  }
  return "statute";
}

function sxxLabel(sxx: string | number | undefined): string | undefined {
  if (sxx === 3 || sxx === "3") {
    return "现行有效";
  }
  if (sxx === 1 || sxx === "1") {
    return "已废止/失效";
  }
  if (sxx === 2 || sxx === "2") {
    return "已修改";
  }
  if (sxx == null || sxx === "") {
    return undefined;
  }
  return `状态:${sxx}`;
}

/**
 * Live list/search via POST /law-search/search/list.
 * Mockable via fetchImpl; CI must not depend on live network.
 */
export async function searchNpcFlkLive(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }> {
  if (!isNpcFlkLiveEnabled()) {
    return { hits: [], error: "npc_flk_disabled" };
  }
  const resolved = resolveNpcFlkEndpoint({ endpoint: opts.endpoint });
  if (!resolved.ok) {
    return { hits: [], error: `npc_endpoint_invalid:${resolved.message}` };
  }
  const safe = await assertOpenLawLiveEndpointSafe(resolved.normalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { hits: [], error: `npc_endpoint_ssrf:${safe.message}` };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = opts.query.trim();
  try {
    const res = await fetchImpl(safe.normalized, {
      method: "POST",
      headers: {
        // WAF on flk.npc.gov.cn often 403s non-browser UAs; match public site clients.
        accept: "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8",
        referer: "https://flk.npc.gov.cn/search",
        origin: "https://flk.npc.gov.cn",
        "x-requested-with": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
      },
      body: JSON.stringify({
        searchContent: q,
        searchType: 2,
        searchRange: 1,
        pageNum: 1,
        pageSize: 10,
        sxrq: [],
        gbrq: [],
        sxx: [],
        gbrqYear: [],
        flfgCodeId: [],
        zdjgCodeId: [],
        xgzlSearch: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) {
      return { hits: [], httpStatus: res.status, error: `http_${res.status}` };
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const text = await res.text();
    if (contentType.includes("text/html") || /^\s*</.test(text)) {
      return {
        hits: [],
        httpStatus: res.status,
        error: "npc_html_shell:旧 /api/ 或端点已改为 SPA；请使用 /law-search/search/list",
      };
    }
    let body: {
      rows?: FlkListRow[];
      result?: { data?: FlkListRow[]; rows?: FlkListRow[] };
      data?: FlkListRow[] | { list?: FlkListRow[]; rows?: FlkListRow[] };
      list?: FlkListRow[];
      code?: number | string;
      msg?: string;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      return { hits: [], httpStatus: res.status, error: "npc_non_json" };
    }
    const rows: FlkListRow[] = Array.isArray(body.rows)
      ? body.rows
      : Array.isArray(body.result?.rows)
        ? body.result.rows
        : Array.isArray(body.result?.data)
          ? body.result.data
          : Array.isArray(body.data)
            ? body.data
            : Array.isArray((body.data as { rows?: FlkListRow[] } | undefined)?.rows)
              ? (body.data as { rows: FlkListRow[] }).rows
              : Array.isArray((body.data as { list?: FlkListRow[] } | undefined)?.list)
                ? (body.data as { list: FlkListRow[] }).list
                : Array.isArray(body.list)
                  ? body.list
                  : [];
    const hits: AuthorityHit[] = [];
    for (const row of rows.slice(0, 12)) {
      const title = stripNpcHighlightHtml(row.title ?? row.name ?? "");
      if (!title) {
        continue;
      }
      const id = (row.bbbs ?? row.id ?? "").trim() || `npc-flk-${hits.length}`;
      const office = (row.zdjgName ?? row.office ?? "").trim();
      const status = sxxLabel(row.sxx) ?? (row.status != null ? String(row.status) : undefined);
      const excerpt = [
        row.flxz,
        office,
        row.gbrq ? `公布:${row.gbrq}` : "",
        row.sxrq ? `施行:${row.sxrq}` : "",
        status,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);
      hits.push({
        id: `npc-flk:${id}`,
        title,
        kind: mapFlxzToKind(row.flxz),
        citation: title,
        excerpt,
        url: row.url?.startsWith("http")
          ? row.url
          : `https://flk.npc.gov.cn/detail.html?${encodeURIComponent(id)}`,
        provider: OPEN_LAW_PROVIDER.npcFlk,
        corpusId: "npc_flk_live",
        licenseNote: NPC_LICENSE_NOTE,
      });
    }
    return { hits, httpStatus: res.status };
  } catch (e) {
    return {
      hits: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
