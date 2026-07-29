/**
 * Optional vendor citation validation hook (C1-5 / G5).
 *
 * When LAWMIND_AUTHORITY_CITATION_VALIDATE=1 and endpoint configured,
 * POST { citations: string[] } → { ok, issues[] }.
 * Without network / unset → skip (ok: true, skipped: true).
 */

import {
  buildAuthorityRequestHeaders,
  resolveAuthorityApiKey,
  resolveAuthorityEndpointRaw,
  validateAuthorityEndpointUrl,
} from "../../authority-health.js";

export type AuthorityCitationIssue = {
  citation: string;
  reason: string;
};

export type AuthorityCitationValidateResult = {
  ok: boolean;
  skipped: boolean;
  issues: AuthorityCitationIssue[];
  message: string;
};

export function isAuthorityCitationValidateEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function validateCitationsWithAuthority(opts: {
  citations: string[];
  endpoint?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<AuthorityCitationValidateResult> {
  if (!isAuthorityCitationValidateEnabled()) {
    return {
      ok: true,
      skipped: true,
      issues: [],
      message: "未启用 LAWMIND_AUTHORITY_CITATION_VALIDATE，跳过厂商引用校验。",
    };
  }
  const citations = opts.citations.map((c) => c.trim()).filter(Boolean);
  if (citations.length === 0) {
    return { ok: true, skipped: false, issues: [], message: "无待校验引用。" };
  }
  const raw = resolveAuthorityEndpointRaw({ endpoint: opts.endpoint });
  if (!raw) {
    return {
      ok: false,
      skipped: false,
      issues: citations.map((citation) => ({
        citation,
        reason: "authority_unset",
      })),
      message: "已启用引用校验但未配置权威端点：请配置或关闭校验。",
    };
  }
  const validated = validateAuthorityEndpointUrl(raw);
  if (!validated.ok) {
    return {
      ok: false,
      skipped: false,
      issues: [{ citation: "*", reason: validated.message }],
      message: `权威端点无效：${validated.message}`,
    };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const validateUrl =
    process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH?.trim() ||
    `${validated.normalized}/validate`;
  try {
    const res = await fetchImpl(validateUrl, {
      method: "POST",
      headers: {
        ...buildAuthorityRequestHeaders({ apiKey: opts.apiKey ?? resolveAuthorityApiKey() }),
        "content-type": "application/json",
      },
      body: JSON.stringify({ citations }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        issues: [{ citation: "*", reason: `http_${res.status}` }],
        message: `引用校验 HTTP ${res.status}：出稿前请人工核验引用。`,
      };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      issues?: AuthorityCitationIssue[];
    };
    const issues = Array.isArray(body.issues) ? body.issues : [];
    const ok = body.ok !== false && issues.length === 0;
    return {
      ok,
      skipped: false,
      issues,
      message: ok
        ? "厂商引用校验通过。"
        : `厂商引用校验未通过（${issues.length} 项）：请修正后再导出。`,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      issues: [{ citation: "*", reason: e instanceof Error ? e.message : String(e) }],
      message: "引用校验请求失败：请检查网络或关闭 LAWMIND_AUTHORITY_CITATION_VALIDATE。",
    };
  }
}
