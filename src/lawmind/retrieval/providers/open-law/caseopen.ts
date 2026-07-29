/**
 * Optional live search against self-hosted cncases/cases (caseopen).
 *
 * Software: Mozilla Public License 2.0 (https://github.com/cncases/cases).
 * Data: publicly published Chinese court judgments (user must host the corpus;
 * default demo caseopen.org is behind Cloudflare and is not a CI dependency).
 *
 * Enable: LAWMIND_OPEN_LAW_CASEOPEN=1
 * Endpoint default: http://127.0.0.1:8081/api/search  (loopback allowed only here)
 */

import type { AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { assertOpenLawLiveEndpointSafe, validateOpenLawLiveEndpointUrl } from "./live-endpoint.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

export const DEFAULT_CASEOPEN_SEARCH = "http://127.0.0.1:8081/api/search";

const CASEOPEN_LICENSE_NOTE =
  "来源：cncases/caseopen 自建检索（软件 MPL-2.0）；裁判文书为法院公开文本，非北大法宝";

export function isCaseopenLiveEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OPEN_LAW_CASEOPEN ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveCaseopenEndpoint(opts?: { endpoint?: string }):
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
    process.env.LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT ??
    DEFAULT_CASEOPEN_SEARCH
  ).trim();
  // Self-hosted cncases defaults to 127.0.0.1 — allow loopback only for this adapter.
  return validateOpenLawLiveEndpointUrl(ep, { allowLoopback: true });
}

type CaseopenCase = {
  id?: number | string;
  case_name?: string;
  case_id?: string;
  court?: string;
  cause?: string;
  judgment_date?: string;
  legal_basis?: string;
  preview?: string;
  full_text?: string;
  doc_id?: string;
  case_type?: string;
};

type CaseopenSearchBody = {
  cases?: CaseopenCase[];
  search_meta?: { total?: number; search?: string };
  hits?: CaseopenCase[];
  items?: CaseopenCase[];
};

/**
 * GET {endpoint}?search=…&search_type=keyword
 * Expects cncases JSON: { search_meta, cases: [...] }.
 */
export async function searchCaseopenLive(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }> {
  if (!isCaseopenLiveEnabled()) {
    return { hits: [], error: "caseopen_disabled" };
  }
  const resolved = resolveCaseopenEndpoint({ endpoint: opts.endpoint });
  if (!resolved.ok) {
    return { hits: [], error: `caseopen_endpoint_invalid:${resolved.message}` };
  }
  const safe = await assertOpenLawLiveEndpointSafe(resolved.normalized, {
    allowLoopback: true,
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { hits: [], error: `caseopen_endpoint_ssrf:${safe.message}` };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = opts.query.trim();
  let url: URL;
  try {
    url = new URL(safe.normalized);
  } catch {
    return { hits: [], error: "caseopen_endpoint_invalid:URL" };
  }
  if (q) {
    url.searchParams.set("search", q);
  }
  if (!url.searchParams.has("search_type")) {
    url.searchParams.set("search_type", "keyword");
  }
  try {
    const res = await fetchImpl(url.toString(), {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "LawMind-OpenLaw/0.2 (+caseopen; self-hosted)",
      },
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
        error:
          "caseopen_html_challenge:公网 demo 可能被 Cloudflare 拦截；请自建 cncases 并指向本机 /api/search",
      };
    }
    let body: CaseopenSearchBody;
    try {
      body = JSON.parse(text) as CaseopenSearchBody;
    } catch {
      return { hits: [], httpStatus: res.status, error: "caseopen_non_json" };
    }
    const rows: CaseopenCase[] = Array.isArray(body.cases)
      ? body.cases
      : Array.isArray(body.hits)
        ? body.hits
        : Array.isArray(body.items)
          ? body.items
          : [];
    const hits: AuthorityHit[] = [];
    for (const row of rows.slice(0, 12)) {
      const title = (row.case_name ?? row.case_id ?? "").trim();
      if (!title) {
        continue;
      }
      const id = row.id != null ? String(row.id) : row.case_id?.trim() || `caseopen-${hits.length}`;
      const excerpt = (
        row.preview ||
        [row.court, row.cause, row.judgment_date, row.legal_basis].filter(Boolean).join(" · ") ||
        (row.full_text ?? "").slice(0, 240)
      ).slice(0, 500);
      hits.push({
        id: `caseopen:${id}`,
        title,
        kind: "case",
        citation: row.case_id?.trim() || title,
        excerpt,
        url: row.doc_id?.startsWith("http")
          ? row.doc_id
          : `${safe.normalized.replace(/\/api\/search\/?$/, "")}/case/${encodeURIComponent(id)}`,
        provider: OPEN_LAW_PROVIDER.caseopen,
        corpusId: "caseopen_self_hosted",
        licenseNote: CASEOPEN_LICENSE_NOTE,
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
