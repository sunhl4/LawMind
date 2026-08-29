/**
 * Optional live search against Japan e-Gov 法令 API v2 (official, no key).
 *
 * Enable: LAWMIND_OPEN_LAW_EGOV_JP=1
 * Endpoint default: https://laws.e-gov.go.jp/api/2/keyword
 */

import { validateAuthorityEndpointUrl } from "../../authority-health.js";
import type { AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { assertOpenLawLiveEndpointSafe } from "./live-endpoint.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

export const DEFAULT_EGOV_JP_KEYWORD = "https://laws.e-gov.go.jp/api/2/keyword";

const EGOV_LICENSE_NOTE =
  "来源：日本 e-Gov 法令 API v2 官方公开检索；日本法，非法宝/威科；尊重限流";

export function isEgovJpLiveEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OPEN_LAW_EGOV_JP ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function resolveEgovJpEndpoint(opts?: { endpoint?: string }):
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
    process.env.LAWMIND_OPEN_LAW_EGOV_JP_ENDPOINT ??
    DEFAULT_EGOV_JP_KEYWORD
  ).trim();
  return validateAuthorityEndpointUrl(ep);
}

type EgovLawInfo = {
  law_id?: string;
  law_num?: string;
  law_title?: string;
  law_type?: string;
};

type EgovSentence = {
  text?: string;
};

type EgovItem = {
  law_info?: EgovLawInfo;
  revision_info?: { law_title?: string; amendment_promulgate_date?: string };
  sentences?: EgovSentence[];
  law_id?: string;
  law_title?: string;
  law_num?: string;
};

type EgovKeywordBody = {
  items?: EgovItem[];
  keyword_items?: EgovItem[];
};

function mapLawTypeToKind(lawType: string | undefined): AuthorityHit["kind"] {
  const t = (lawType ?? "").trim();
  if (/CabinetOrder|ImperialOrder|MinisterialOrdinance|Order|Ordinance/i.test(t)) {
    return "regulation";
  }
  return "statute";
}

/**
 * GET {endpoint}?keyword=…&limit=8
 */
export async function searchEgovJpLive(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }> {
  if (!isEgovJpLiveEnabled()) {
    return { hits: [], error: "egov_jp_disabled" };
  }
  const resolved = resolveEgovJpEndpoint({ endpoint: opts.endpoint });
  if (!resolved.ok) {
    return { hits: [], error: `egov_jp_endpoint_invalid:${resolved.message}` };
  }
  const safe = await assertOpenLawLiveEndpointSafe(resolved.normalized, {
    lookup: opts.lookup,
  });
  if (!safe.ok) {
    return { hits: [], error: `egov_jp_endpoint_ssrf:${safe.message}` };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const q = opts.query.trim();
  let url: URL;
  try {
    url = new URL(safe.normalized);
  } catch {
    return { hits: [], error: "egov_jp_endpoint_invalid:URL" };
  }
  if (q) {
    url.searchParams.set("keyword", q);
  }
  if (!url.searchParams.has("limit")) {
    url.searchParams.set("limit", "8");
  }
  try {
    const res = await fetchImpl(url.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": "LawMind-OpenLaw/0.2 (+egov-jp; laws.e-gov.go.jp API v2)",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
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
        error: "egov_jp_html_shell:端点未返回 JSON",
      };
    }
    let body: EgovKeywordBody;
    try {
      body = JSON.parse(text) as EgovKeywordBody;
    } catch {
      return { hits: [], httpStatus: res.status, error: "egov_jp_non_json" };
    }
    const rows = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.keyword_items)
        ? body.keyword_items
        : [];
    const hits: AuthorityHit[] = [];
    for (const row of rows.slice(0, 12)) {
      const info = row.law_info ?? {};
      const title = (info.law_title ?? row.revision_info?.law_title ?? row.law_title ?? "").trim();
      if (!title) {
        continue;
      }
      const lawId = (info.law_id ?? row.law_id ?? "").trim();
      const lawNum = (info.law_num ?? row.law_num ?? "").trim();
      const excerpt = [
        lawNum,
        info.law_type,
        row.revision_info?.amendment_promulgate_date,
        row.sentences?.[0]?.text,
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);
      hits.push({
        id: `egov-jp:${lawId || hits.length}`,
        title,
        kind: mapLawTypeToKind(info.law_type),
        citation: lawNum || title,
        excerpt,
        url: lawId
          ? `https://laws.e-gov.go.jp/law/${encodeURIComponent(lawId)}`
          : "https://laws.e-gov.go.jp/",
        provider: OPEN_LAW_PROVIDER.egovJp,
        corpusId: "egov_jp_v2",
        licenseNote: EGOV_LICENSE_NOTE,
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
