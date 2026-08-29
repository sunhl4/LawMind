/**
 * Microsoft Graph client-credentials listing (read-only).
 */

import type { IntegrationDocumentEntry } from "./integration-types.js";

export type SharePointGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
};

export type GraphListResult =
  | { ok: true; documents: IntegrationDocumentEntry[] }
  | { ok: false; error: string; hint?: string };

async function fetchAccessToken(cfg: SharePointGraphConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token_failed:${res.status}:${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("token_missing_access_token");
  }
  return json.access_token;
}

export async function listSharePointDriveChildren(
  cfg: SharePointGraphConfig,
): Promise<GraphListResult> {
  try {
    const token = await fetchAccessToken(cfg);
    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(cfg.siteId)}/drive/root/children?$select=name,size,lastModifiedDateTime,id,webUrl`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: "graph_list_failed",
        hint: `Graph ${res.status}: ${text.slice(0, 120)}`,
      };
    }
    const json = (await res.json()) as {
      value?: Array<{
        name?: string;
        size?: number;
        lastModifiedDateTime?: string;
        id?: string;
        webUrl?: string;
      }>;
    };
    const documents: IntegrationDocumentEntry[] = (json.value ?? []).map((item) => ({
      name: item.name ?? "unknown",
      relativePath: `sharepoint://${cfg.siteId}/${item.id ?? item.name}`,
      sizeBytes: item.size ?? 0,
      modifiedAt: item.lastModifiedDateTime ?? new Date().toISOString(),
      source: "sharepoint",
      ...(item.webUrl?.trim() ? { webUrl: item.webUrl.trim() } : {}),
    }));
    return { ok: true, documents };
  } catch (err) {
    return {
      ok: false,
      error: "graph_exception",
      hint: err instanceof Error ? err.message : String(err),
    };
  }
}
