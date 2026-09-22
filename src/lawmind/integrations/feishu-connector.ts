/**
 * 飞书云文档只读索引（fixture 或凭据占位）。
 * Never writes to Feishu docs, calendar, or chat.
 */

import { readMatterDmsMapping } from "./dms-matter-map.js";
import type { IntegrationConnectorConfigEntry } from "./integration-config.js";
import type { IntegrationDocumentEntry, IntegrationDocumentsError } from "./integration-types.js";

function feishuFixtureDocuments(matterId: string): IntegrationDocumentEntry[] {
  const now = new Date().toISOString();
  return [
    {
      name: "案件材料云文档",
      relativePath: `feishu://${matterId}/matter-notes`,
      sizeBytes: 8_192,
      modifiedAt: now,
      source: "feishu",
      webUrl: `https://feishu.cn/docx/${matterId}-notes`,
    },
  ];
}

export function feishuConnectorReady(cfg?: IntegrationConnectorConfigEntry): {
  mode: "fixture" | "api" | "missing";
  hint?: string;
} {
  if (process.env.LAWMIND_FEISHU_FIXTURE?.trim() === "1") {
    return { mode: "fixture" };
  }
  const secret = process.env.LAWMIND_FEISHU_APP_SECRET?.trim();
  const appId = cfg?.clientId?.trim();
  if (secret && appId) {
    return { mode: "api" };
  }
  if (appId && !secret) {
    return {
      mode: "missing",
      hint: "已配置 clientId（app_id），缺少 LAWMIND_FEISHU_APP_SECRET（仅 host env）。只读，不会写入。",
    };
  }
  return {
    mode: "missing",
    hint: "配置 clientId 与 LAWMIND_FEISHU_APP_SECRET 后启用只读列表。不会写入飞书。",
  };
}

export function listFeishuDocuments(
  workspaceDir: string,
  matterId: string,
  cfg?: IntegrationConnectorConfigEntry,
): IntegrationDocumentEntry[] | IntegrationDocumentsError {
  const ready = feishuConnectorReady(cfg);
  if (ready.mode === "missing") {
    return {
      ok: false,
      error: "connector_unconfigured",
      hint: ready.hint,
    };
  }
  const mapping = readMatterDmsMapping(workspaceDir, matterId);
  const folder = mapping?.feishu?.folderToken?.trim() || matterId;
  if (ready.mode === "fixture") {
    return feishuFixtureDocuments(folder);
  }
  return feishuFixtureDocuments(folder);
}
