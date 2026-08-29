/**
 * Optional live search against CourtListener / Free Law Project REST v4.
 *
 * Official public API (AGPL service; we only call HTTP — do not vendor their code).
 * Harvard Caselaw Access Project live API (api.case.law) retired in 2024; CAP
 * historical opinions are now searchable here.
 *
 * Enable: LAWMIND_OPEN_LAW_COURTLISTENER=1
 * Optional token (higher rate limit; never put in URL):
 *   LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN
 */

import { validateAuthorityEndpointUrl } from "../../authority-health.js";
import type { AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { assertOpenLawLiveEndpointSafe } from "./live-endpoint.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

export const DEFAULT_COURTLISTENER_SEARCH = "https://www.courtlistener.com/api/rest/v4/search/";

const COURTLISTENER_LICENSE_NOTE =
  "来源：CourtListener / Free Law Project 公开 REST API（含 Harvard CAP 历史判例）；美判例，非法宝/威科；限流，建议自备 Token";

export function isCourtListenerLiveEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OPEN_LAW_COURTLISTENER ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveCourtListenerToken(opts?: { token?: string }): string {
  const fromOpts = opts?.token?.trim() ?? "";
  if (fromOpts) {
    return fromOpts;
  }
  return process.env.LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN?.trim() || "";
}

export function resolveCourtListenerEndpoint(opts?: { endpoint?: string }):
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
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER_ENDPOINT ??
    DEFAULT_COURTLISTENER_SEARCH
  ).trim();
  return validateAuthorityEndpointUrl(ep);
}

type CourtListenerResult = {
  absolute_url?: string;
  caseName?: string;
  caseNameFull?: string;
  citation?: string[] | string;
  court?: string;
  court_citation_string?: string;
  dateFiled?: string;
  snippet?: string;
  cluster_id?: number | string;
  docketNumber?: string;
};

type CourtListenerSearchBody = {
  count?: number;
  results?: CourtListenerResult[];
};

function formatCitation(raw: CourtListenerResult["citation"]): string | undefined {
  if (Array.isArray(raw)) {
    const first = raw.find((c) => typeof c === "string" && c.trim());
    return first?.trim();
  }
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/**
 * GET {endpoint}?q=…&type=o
 * Expects CourtListener v4 search JSON: { count, results: [...] }.
 */
export async function searchCourtListenerLive(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  token?: string;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }> {
  if (!isCourtListenerLiveEnabled()) {
    return { hits: [], error: "courtlistener_disabled" };
  }
  const resolved = resolveCourtListenerEndpoint({ endpoint: opts.endpoint });
  if (!resolved.ok) {
    return { hits: [], error: `courtlistener_endpoint_invalid:${resolved.message}` };
  }
  const safe = await assertOpenLawLiveEndpointSafe(resolved.normalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { hits: [], error: `courtlistener_endpoint_ssrf:${safe.message}` };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = opts.query.trim();
  let url: URL;
  try {
    url = new URL(safe.normalized);
  } catch {
    return { hits: [], error: "courtlistener_endpoint_invalid:URL" };
  }
  if (q) {
    url.searchParams.set("q", q);
  }
  if (!url.searchParams.has("type")) {
    url.searchParams.set("type", "o");
  }
  const token = resolveCourtListenerToken({ token: opts.token });
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "LawMind-OpenLaw/0.2 (+courtlistener; Free Law Project REST v4)",
  };
  if (token) {
    headers.authorization = `Token ${token}`;
  }
  try {
    const res = await fetchImpl(url.toString(), {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
    if (!res.ok) {
      const hint =
        res.status === 429
          ? "courtlistener_rate_limited:请设置 LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN 或降低频率"
          : `http_${res.status}`;
      return { hits: [], httpStatus: res.status, error: hint };
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const text = await res.text();
    if (contentType.includes("text/html") || /^\s*</.test(text)) {
      return {
        hits: [],
        httpStatus: res.status,
        error: "courtlistener_html_shell:端点未返回 JSON",
      };
    }
    let body: CourtListenerSearchBody;
    try {
      body = JSON.parse(text) as CourtListenerSearchBody;
    } catch {
      return { hits: [], httpStatus: res.status, error: "courtlistener_non_json" };
    }
    const rows = Array.isArray(body.results) ? body.results : [];
    const hits: AuthorityHit[] = [];
    for (const row of rows.slice(0, 12)) {
      const title = (row.caseName ?? row.caseNameFull ?? "").trim();
      if (!title) {
        continue;
      }
      const id = row.cluster_id != null ? String(row.cluster_id) : `cl-${hits.length}`;
      const citation = formatCitation(row.citation) || title;
      const excerpt = [
        row.court_citation_string ?? row.court,
        row.dateFiled,
        row.docketNumber ? `Docket ${row.docketNumber}` : "",
        row.snippet,
      ]
        .filter(Boolean)
        .join(" · ")
        .replace(/<[^>]+>/g, "")
        .slice(0, 500);
      const path = (row.absolute_url ?? "").trim();
      const urlOut = path.startsWith("http")
        ? path
        : path
          ? `https://www.courtlistener.com${path.startsWith("/") ? "" : "/"}${path}`
          : "https://www.courtlistener.com/";
      hits.push({
        id: `courtlistener:${id}`,
        title,
        kind: "case",
        citation,
        excerpt,
        url: urlOut,
        provider: OPEN_LAW_PROVIDER.courtlistener,
        corpusId: "courtlistener_v4",
        licenseNote: COURTLISTENER_LICENSE_NOTE,
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
