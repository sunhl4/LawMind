/**
 * URL dossier — controlled multi-URL fetch with provenance for compliance research.
 * Uses commercial authority SSRF guards; respects workspace network allowlist when provided.
 */

import { createHash } from "node:crypto";
import { resolveEdition } from "../policy/edition.js";
import { checkNetworkAllowlist, hostnameFromUrl } from "../policy/network-allowlist.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import {
  assertAuthorityEndpointSafeToFetch,
  validateAuthorityEndpointUrl,
} from "../retrieval/authority-health.js";
import type { ResearchClaim, ResearchSource } from "../types.js";

export type UrlDossierFetchStatus = "ok" | "blocked" | "error" | "empty";

export type UrlDossierEntry = {
  url: string;
  status: UrlDossierFetchStatus;
  fetchedAt: string;
  contentHash?: string;
  title?: string;
  hostname?: string;
  httpStatus?: number;
  /** Truncated plain/markdown text for LLM use */
  textExcerpt?: string;
  byteLength?: number;
  error?: string;
  sourceId?: string;
};

export type UrlDossierResult = {
  entries: UrlDossierEntry[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  okCount: number;
  blockedCount: number;
  errorCount: number;
};

const MAX_BYTES = 400_000;
const MAX_EXCERPT = 12_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

function stripHtmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const titleMatch = withoutScripts.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return title ? `${title}\n\n${text}` : text;
}

function hashContent(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

function inferTitle(text: string, url: string): string {
  const first = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (first && first.length <= 120) {
    return first;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 80);
  }
}

function classifyAuthorityHint(url: string, text: string): ResearchSource["kind"] {
  const host = hostnameFromUrl(url) ?? "";
  if (/\.gov(\.|$)|npc\.gov|court\.gov|samr\.gov|moj\.gov/i.test(host)) {
    if (/条例|办法|规定|法\b|规章/.test(text.slice(0, 800))) {
      return "regulation";
    }
    return "statute";
  }
  if (/裁判|判决|裁定|case/i.test(text.slice(0, 400))) {
    return "case";
  }
  return "web";
}

export function parseUrlList(input: string | string[]): string[] {
  const raw = Array.isArray(input) ? input : input.split(/[\n,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const u = item.trim();
    if (!u || seen.has(u)) {
      continue;
    }
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** Extract http(s) URLs from free text (instruction paste, etc.). */
export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'）】\]]+/gi) ?? [];
  return parseUrlList(matches.map((u) => u.replace(/[.,;:]+$/g, "")));
}

export async function fetchUrlDossier(opts: {
  urls: string | string[];
  workspacePolicy?: LawMindWorkspacePolicy | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxUrls?: number;
  modelLabel?: string;
  signal?: AbortSignal;
}): Promise<UrlDossierResult> {
  const urls = parseUrlList(opts.urls).slice(0, opts.maxUrls ?? 20);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const edition = resolveEdition({ policy: opts.workspacePolicy ?? null }).edition;
  const claimModel: ResearchClaim["model"] =
    opts.modelLabel?.trim() === "legal" ? "legal" : "general";

  const entries: UrlDossierEntry[] = [];
  const sources: ResearchSource[] = [];
  const claims: ResearchClaim[] = [];
  let okCount = 0;
  let blockedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const fetchedAt = new Date().toISOString();
    const host = hostnameFromUrl(url);

    const validated = validateAuthorityEndpointUrl(url);
    if (!validated.ok) {
      blockedCount += 1;
      entries.push({
        url,
        status: "blocked",
        fetchedAt,
        hostname: host ?? undefined,
        error: validated.message,
      });
      continue;
    }

    // Always apply allowlist (firm/private_deploy fail-closed even when policy file is missing).
    if (host) {
      const allow = checkNetworkAllowlist({
        policy: opts.workspacePolicy ?? null,
        edition,
        hostname: host,
      });
      if (!allow.allowed) {
        blockedCount += 1;
        entries.push({
          url,
          status: "blocked",
          fetchedAt,
          hostname: host,
          error: allow.reason ?? "network allowlist blocked",
        });
        continue;
      }
    }

    const safe = await assertAuthorityEndpointSafeToFetch(url);
    if (!safe.ok) {
      blockedCount += 1;
      entries.push({
        url,
        status: "blocked",
        fetchedAt,
        hostname: host ?? undefined,
        error: safe.message,
      });
      continue;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onParentAbort = () => controller.abort();
      opts.signal?.addEventListener("abort", onParentAbort, { once: true });
      const headers = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": "LawMind-UrlDossier/1.0 (+local research; respect robots)",
      };
      // Manual redirect loop: SSRF + allowlist on every hop.
      let currentUrl = safe.normalized;
      let res: Response | undefined;
      let redirectBlocked: string | undefined;
      let redirectError: string | undefined;
      let hops = 0;
      while (hops <= MAX_REDIRECTS) {
        res = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers,
        });
        if (res.status < 300 || res.status >= 400) {
          break;
        }
        const loc = res.headers.get("location");
        if (!loc) {
          redirectError = "redirect without location";
          break;
        }
        hops += 1;
        if (hops > MAX_REDIRECTS) {
          redirectError = `too many redirects (>${MAX_REDIRECTS})`;
          break;
        }
        const nextUrl = new URL(loc, currentUrl).toString();
        const nextSafe = await assertAuthorityEndpointSafeToFetch(nextUrl);
        if (!nextSafe.ok) {
          redirectBlocked = `redirect blocked: ${nextSafe.message}`;
          break;
        }
        const nextHost = hostnameFromUrl(nextSafe.normalized);
        if (nextHost) {
          const nextAllow = checkNetworkAllowlist({
            policy: opts.workspacePolicy ?? null,
            edition,
            hostname: nextHost,
          });
          if (!nextAllow.allowed) {
            redirectBlocked = `redirect blocked: ${nextAllow.reason ?? "network allowlist blocked"}`;
            break;
          }
        }
        currentUrl = nextSafe.normalized;
      }
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onParentAbort);

      if (redirectBlocked) {
        blockedCount += 1;
        entries.push({
          url,
          status: "blocked",
          fetchedAt,
          hostname: hostnameFromUrl(currentUrl) ?? host ?? undefined,
          httpStatus: res?.status,
          error: redirectBlocked,
        });
        continue;
      }
      if (redirectError || !res) {
        errorCount += 1;
        entries.push({
          url,
          status: "error",
          fetchedAt,
          hostname: host ?? undefined,
          httpStatus: res?.status,
          error: redirectError ?? "empty response",
        });
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        errorCount += 1;
        entries.push({
          url,
          status: "error",
          fetchedAt,
          hostname: host ?? undefined,
          httpStatus: res.status,
          error: "unresolved redirect",
        });
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
      const contentHash = hashContent(buf);
      const contentType = res.headers.get("content-type") ?? "";
      let text = "";
      if (/html/i.test(contentType) || buf.subarray(0, 32).toString("utf8").includes("<")) {
        text = stripHtmlToText(buf.toString("utf8"));
      } else {
        text = buf.toString("utf8").split(String.fromCharCode(0)).join("").trim();
      }
      const excerpt = text.slice(0, MAX_EXCERPT);
      if (!res.ok) {
        errorCount += 1;
        entries.push({
          url,
          status: "error",
          fetchedAt,
          hostname: host ?? undefined,
          httpStatus: res.status,
          contentHash,
          byteLength: buf.length,
          error: `HTTP ${res.status}`,
          textExcerpt: excerpt || undefined,
        });
        continue;
      }
      if (!excerpt.trim()) {
        errorCount += 1;
        entries.push({
          url,
          status: "empty",
          fetchedAt,
          hostname: host ?? undefined,
          httpStatus: res.status,
          contentHash,
          byteLength: buf.length,
          error: "empty body",
        });
        continue;
      }

      const sourceId = `url-${i + 1}-${contentHash.slice(0, 8)}`;
      const title = inferTitle(excerpt, url);
      const kind = classifyAuthorityHint(url, excerpt);
      okCount += 1;
      entries.push({
        url,
        status: "ok",
        fetchedAt,
        hostname: host ?? undefined,
        httpStatus: res.status,
        contentHash,
        title,
        textExcerpt: excerpt,
        byteLength: buf.length,
        sourceId,
      });
      sources.push({
        id: sourceId,
        kind,
        title,
        citation: `${title} — ${url} (fetched ${fetchedAt}; hash ${contentHash})`,
        url,
        provider: "url-dossier",
        licenseNote: "Public web fetch for lawyer research; verify official status before relying.",
      });
      const preview = excerpt.replace(/\s+/g, " ").trim().slice(0, 280);
      claims.push({
        text: `来源摘录（待律师核验）：${preview}`,
        confidence: 0.55,
        sourceIds: [sourceId],
        model: claimModel,
      });
    } catch (err) {
      errorCount += 1;
      entries.push({
        url,
        status: "error",
        fetchedAt,
        hostname: host ?? undefined,
        error: err instanceof Error ? err.message.slice(0, 280) : String(err).slice(0, 280),
      });
    }
  }

  return { entries, sources, claims, okCount, blockedCount, errorCount };
}

/** Merge dossier sources/claims into an existing research-like payload. */
export function mergeDossierIntoBundleParts(
  base: { sources: ResearchSource[]; claims: ResearchClaim[] },
  dossier: UrlDossierResult,
): { sources: ResearchSource[]; claims: ResearchClaim[] } {
  const sourceIds = new Set(base.sources.map((s) => s.id));
  const sources = [...base.sources];
  for (const s of dossier.sources) {
    if (!sourceIds.has(s.id)) {
      sources.push(s);
      sourceIds.add(s.id);
    }
  }
  const claimKeys = new Set(base.claims.map((c) => `${c.text}\0${c.sourceIds.join(",")}`));
  const claims = [...base.claims];
  for (const c of dossier.claims) {
    const key = `${c.text}\0${c.sourceIds.join(",")}`;
    if (!claimKeys.has(key)) {
      claims.push(c);
      claimKeys.add(key);
    }
  }
  return { sources, claims };
}
