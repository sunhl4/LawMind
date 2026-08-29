/**
 * SharePoint / Microsoft Graph read-only connector (fixture or env-gated).
 */

import { readMatterDmsMapping } from "./dms-matter-map.js";
import type { IntegrationConnectorConfigEntry } from "./integration-config.js";
import type { IntegrationDocumentEntry, IntegrationDocumentsError } from "./integration-types.js";
import { listSharePointDriveChildren } from "./sharepoint-graph.js";

function sharepointFixtureDocuments(matterId: string): IntegrationDocumentEntry[] {
  const now = new Date().toISOString();
  return [
    {
      name: "Case Binder.pdf",
      relativePath: `sharepoint://${matterId}/binder.pdf`,
      sizeBytes: 512_000,
      modifiedAt: now,
      source: "sharepoint",
    },
  ];
}

export function sharepointConnectorReady(cfg?: IntegrationConnectorConfigEntry): {
  mode: "fixture" | "api" | "missing";
  hint?: string;
} {
  if (process.env.LAWMIND_SHAREPOINT_FIXTURE?.trim() === "1") {
    return { mode: "fixture" };
  }
  const secret = process.env.LAWMIND_SHAREPOINT_CLIENT_SECRET?.trim();
  const tenantId = cfg?.tenantId?.trim();
  if (secret && tenantId) {
    return { mode: "api" };
  }
  if (tenantId && !secret) {
    return {
      mode: "missing",
      hint: "已配置 tenantId，缺少 LAWMIND_SHAREPOINT_CLIENT_SECRET（仅 host env）。",
    };
  }
  return { mode: "missing", hint: "配置 tenantId 与 client secret 后启用 Graph 只读列表。" };
}

export async function listSharepointDocuments(
  workspaceDir: string,
  matterId: string,
  cfg?: IntegrationConnectorConfigEntry,
): Promise<IntegrationDocumentEntry[] | IntegrationDocumentsError> {
  const ready = sharepointConnectorReady(cfg);
  if (ready.mode === "missing") {
    return {
      ok: false,
      error: "connector_unconfigured",
      hint: ready.hint,
    };
  }
  const mapping = readMatterDmsMapping(workspaceDir, matterId);
  const siteId = mapping?.sharepoint?.siteId?.trim() || matterId;
  if (ready.mode === "fixture") {
    return sharepointFixtureDocuments(siteId);
  }
  const secret = process.env.LAWMIND_SHAREPOINT_CLIENT_SECRET?.trim();
  const tenantId = cfg?.tenantId?.trim();
  const clientId = cfg?.clientId?.trim();
  if (!secret || !tenantId || !clientId) {
    return {
      ok: false,
      error: "connector_unconfigured",
      hint: "SharePoint Graph 需要 tenantId、clientId 与 LAWMIND_SHAREPOINT_CLIENT_SECRET。",
    };
  }
  const graph = await listSharePointDriveChildren({
    tenantId,
    clientId,
    clientSecret: secret,
    siteId,
  });
  if (!graph.ok) {
    return { ok: false, error: graph.error, hint: graph.hint };
  }
  return graph.documents;
}
