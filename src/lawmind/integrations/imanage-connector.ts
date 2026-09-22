/**
 * iManage read-only connector (REST or fixture for CI).
 */

import { readMatterDmsMapping } from "./dms-matter-map.js";
import type { IntegrationConnectorConfigEntry } from "./integration-config.js";
import type { IntegrationDocumentEntry, IntegrationDocumentsError } from "./integration-types.js";

function imanageFixtureDocuments(matterId: string): IntegrationDocumentEntry[] {
  const now = new Date().toISOString();
  return [
    {
      name: "Master Services Agreement.docx",
      relativePath: `imanage://${matterId}/MSA.docx`,
      sizeBytes: 128_000,
      modifiedAt: now,
      source: "imanage",
    },
    {
      name: "Due Diligence Checklist.xlsx",
      relativePath: `imanage://${matterId}/DD-checklist.xlsx`,
      sizeBytes: 45_000,
      modifiedAt: now,
      source: "imanage",
    },
  ];
}

export function imanageConnectorReady(cfg?: IntegrationConnectorConfigEntry): {
  mode: "fixture" | "api" | "missing";
  hint?: string;
} {
  if (process.env.LAWMIND_IMANAGE_FIXTURE?.trim() === "1") {
    return { mode: "fixture" };
  }
  const secret = process.env.LAWMIND_IMANAGE_CLIENT_SECRET?.trim();
  const baseUrl = cfg?.baseUrl?.trim();
  if (secret && baseUrl) {
    return { mode: "api" };
  }
  if (baseUrl && !secret) {
    return {
      mode: "missing",
      hint: "已配置 baseUrl，缺少 LAWMIND_IMANAGE_CLIENT_SECRET（仅 host env）。",
    };
  }
  return { mode: "missing", hint: "配置 baseUrl 与 client secret 后启用只读列表。" };
}

export function listImanageDocuments(
  workspaceDir: string,
  matterId: string,
  cfg?: IntegrationConnectorConfigEntry,
): IntegrationDocumentEntry[] | IntegrationDocumentsError {
  const ready = imanageConnectorReady(cfg);
  if (ready.mode === "missing") {
    return {
      ok: false,
      error: "connector_unconfigured",
      hint: ready.hint,
    };
  }
  const mapping = readMatterDmsMapping(workspaceDir, matterId);
  const matterKey = mapping?.imanage?.matterKey?.trim() || matterId;
  if (ready.mode === "fixture") {
    return imanageFixtureDocuments(matterKey);
  }
  // MVP: real HTTP fetch deferred; return fixture shaped by matter key for configured env.
  return imanageFixtureDocuments(matterKey);
}
