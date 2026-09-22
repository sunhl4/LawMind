/**
 * Optional live search against EU Publications Office CELLAR SPARQL
 * (EUR-Lex official metadata graph — no commercial key).
 *
 * Enable: LAWMIND_OPEN_LAW_EURLEX=1
 * Endpoint default: https://publications.europa.eu/webapi/rdf/sparql
 *
 * Query is sanitized before interpolation (no raw SPARQL from the lawyer).
 */

import { validateAuthorityEndpointUrl } from "../../authority-health.js";
import type { AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { assertOpenLawLiveEndpointSafe } from "./live-endpoint.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

export const DEFAULT_EURLEX_SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";

const EURLEX_LICENSE_NOTE =
  "来源：欧盟出版物办公室 CELLAR SPARQL / EUR-Lex 公开元数据；欧盟法，非法宝/威科；接口限流";

export function isEurlexLiveEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OPEN_LAW_EURLEX ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveEurlexEndpoint(opts?: { endpoint?: string }):
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
    process.env.LAWMIND_OPEN_LAW_EURLEX_ENDPOINT ??
    DEFAULT_EURLEX_SPARQL
  ).trim();
  return validateAuthorityEndpointUrl(ep);
}

/** Strip SPARQL metacharacters so the needle is a literal CONTAINS argument. */
export function sanitizeEurlexNeedle(raw: string): string {
  return raw
    .replace(/["\\\r\n\t<>{}()|;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildEurlexSparql(query: string): string | null {
  const needle = sanitizeEurlexNeedle(query);
  if (needle.length < 2) {
    return null;
  }
  return `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?work ?title ?celex WHERE {
  ?work cdm:work_has_expression ?expr .
  ?expr cdm:expression_title ?title .
  OPTIONAL { ?work cdm:resource_legal_id_celex ?celex }
  FILTER(CONTAINS(LCASE(STR(?title)), LCASE("${needle}")))
}
LIMIT 8`;
}

type SparqlTerm = { type?: string; value?: string };
type SparqlBinding = Record<string, SparqlTerm>;
type SparqlBody = {
  results?: { bindings?: SparqlBinding[] };
};

function bindingValue(row: SparqlBinding, key: string): string {
  return (row[key]?.value ?? "").trim();
}

function eurlexUrl(celex: string, workUri: string): string {
  if (celex) {
    return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
  }
  if (workUri.startsWith("http")) {
    return workUri;
  }
  return "https://eur-lex.europa.eu/";
}

/**
 * POST SPARQL → application/sparql-results+json.
 */
export async function searchEurlexLive(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }> {
  if (!isEurlexLiveEnabled()) {
    return { hits: [], error: "eurlex_disabled" };
  }
  const sparql = buildEurlexSparql(opts.query);
  if (!sparql) {
    return { hits: [], error: "eurlex_query_too_short" };
  }
  const resolved = resolveEurlexEndpoint({ endpoint: opts.endpoint });
  if (!resolved.ok) {
    return { hits: [], error: `eurlex_endpoint_invalid:${resolved.message}` };
  }
  const safe = await assertOpenLawLiveEndpointSafe(resolved.normalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { hits: [], error: `eurlex_endpoint_ssrf:${safe.message}` };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(safe.normalized, {
      method: "POST",
      headers: {
        accept: "application/sparql-results+json, application/json",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "LawMind-OpenLaw/0.2 (+eurlex-cellar)",
      },
      body: new URLSearchParams({
        query: sparql,
        format: "application/sparql-results+json",
      }).toString(),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
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
        error: "eurlex_html_shell:CELLAR 未返回 SPARQL JSON",
      };
    }
    let body: SparqlBody;
    try {
      body = JSON.parse(text) as SparqlBody;
    } catch {
      return { hits: [], httpStatus: res.status, error: "eurlex_non_json" };
    }
    const rows = Array.isArray(body.results?.bindings) ? body.results.bindings : [];
    const hits: AuthorityHit[] = [];
    for (const row of rows.slice(0, 12)) {
      const title = bindingValue(row, "title");
      if (!title) {
        continue;
      }
      const celex = bindingValue(row, "celex");
      const work = bindingValue(row, "work");
      const id = celex || work || `eurlex-${hits.length}`;
      hits.push({
        id: `eurlex:${id}`,
        title,
        kind: "regulation",
        citation: celex ? `CELEX ${celex}` : title,
        excerpt: [celex ? `CELEX ${celex}` : "", title].filter(Boolean).join(" · ").slice(0, 500),
        url: eurlexUrl(celex, work),
        provider: OPEN_LAW_PROVIDER.eurlex,
        corpusId: "eurlex_cellar",
        licenseNote: EURLEX_LICENSE_NOTE,
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
