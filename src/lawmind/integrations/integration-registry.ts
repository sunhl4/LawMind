/**
 * Integration connector registry — catalog, status, read-only document index.
 */

import fs from "node:fs";
import path from "node:path";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { listFilesystemDocuments } from "./filesystem-connector.js";
import { imanageConnectorReady, listImanageDocuments } from "./imanage-connector.js";
import { isConnectorEnabled, loadIntegrationsConfig } from "./integration-config.js";
import {
  type IntegrationConnectorCatalogEntry,
  type IntegrationConnectorId,
  type IntegrationConnectorStatus,
  type IntegrationDocumentsError,
  type IntegrationDocumentsResult,
  INTEGRATION_CONNECTOR_IDS,
} from "./integration-types.js";
import { listSharepointDocuments, sharepointConnectorReady } from "./sharepoint-connector.js";
import { stubDocumentsError } from "./stub-connectors.js";

export const INTEGRATION_CONNECTOR_CATALOG: IntegrationConnectorCatalogEntry[] = [
  {
    id: "filesystem",
    label: "本地案件目录",
    phase: "M2",
    description: "索引 workspace/cases/<matterId>/ 下的文件元数据（只读）。",
  },
  {
    id: "imanage",
    label: "iManage",
    phase: "M2",
    description: "DMS 文档列表（规划：Firm API 密钥 + 只读索引）。",
  },
  {
    id: "netdocuments",
    label: "NetDocuments",
    phase: "M2",
    description: "DMS 文档列表（规划：OAuth 只读索引）。",
  },
  {
    id: "sharepoint",
    label: "SharePoint",
    phase: "M2",
    description: "Microsoft Graph 只读文档元数据（规划）。",
  },
];

function matterExists(workspaceDir: string, matterId: string): boolean {
  const loaded = loadMatter(workspaceDir, matterId);
  if (loaded) {
    return true;
  }
  const caseDir = path.join(path.resolve(workspaceDir), "cases", matterId);
  try {
    return fs.existsSync(caseDir) && fs.statSync(caseDir).isDirectory();
  } catch {
    return false;
  }
}

export function assertMatterScope(
  workspaceDir: string,
  matterId: string,
): IntegrationDocumentsError | null {
  const trimmed = matterId.trim();
  if (!trimmed) {
    return { ok: false, error: "matter_id_required", hint: "请提供 matterId 查询参数。" };
  }
  if (!isValidMatterId(trimmed)) {
    return { ok: false, error: "invalid_matter_id", hint: "案件编号格式无效。" };
  }
  if (!matterExists(workspaceDir, trimmed)) {
    return { ok: false, error: "matter_not_found", hint: "未找到该案件。" };
  }
  return null;
}

export function resolveConnectorStatus(
  workspaceDir: string,
  entry: IntegrationConnectorCatalogEntry,
): IntegrationConnectorStatus {
  const config = loadIntegrationsConfig(workspaceDir);
  const enabled = isConnectorEnabled(config, entry.id);
  if (entry.id === "filesystem") {
    return {
      ...entry,
      status: enabled ? "active" : "disabled",
      hint: enabled ? "已索引 cases/<matterId>/ 目录" : "在 integrations.json 中启用 filesystem",
    };
  }
  const cfg = config.connectors[entry.id];
  if (!enabled) {
    return {
      ...entry,
      status: "disabled",
      hint: "在 lawmind/integrations.json 中设置 enabled: true",
    };
  }
  if (entry.id === "imanage") {
    const ready = imanageConnectorReady(cfg);
    if (ready.mode === "fixture" || ready.mode === "api") {
      return {
        ...entry,
        status: "active",
        hint:
          ready.mode === "fixture"
            ? "Fixture 模式（LAWMIND_IMANAGE_FIXTURE=1）"
            : "OAuth 凭据已配置（只读列表）",
      };
    }
    return {
      ...entry,
      status: "unconfigured",
      hint: ready.hint ?? "需配置 baseUrl 与 LAWMIND_IMANAGE_CLIENT_SECRET",
    };
  }
  if (entry.id === "sharepoint") {
    const ready = sharepointConnectorReady(cfg);
    if (ready.mode === "fixture" || ready.mode === "api") {
      return {
        ...entry,
        status: "active",
        hint:
          ready.mode === "fixture"
            ? "Fixture 模式（LAWMIND_SHAREPOINT_FIXTURE=1）"
            : "Graph 凭据已配置（只读列表）",
      };
    }
    return {
      ...entry,
      status: "unconfigured",
      hint: ready.hint ?? "需配置 tenantId 与 LAWMIND_SHAREPOINT_CLIENT_SECRET",
    };
  }
  const hasBase = Boolean(cfg?.baseUrl?.trim() || cfg?.tenantId?.trim());
  return {
    ...entry,
    status: "unconfigured",
    hint: hasBase ? "凭据已占位；真实 API 调用尚未实现（M2 POC）" : "需配置 baseUrl 或 tenantId",
  };
}

export function listIntegrationConnectorStatuses(
  workspaceDir: string,
): IntegrationConnectorStatus[] {
  return INTEGRATION_CONNECTOR_CATALOG.map((e) => resolveConnectorStatus(workspaceDir, e));
}

export function isKnownConnectorId(raw: string): raw is IntegrationConnectorId {
  return (INTEGRATION_CONNECTOR_IDS as readonly string[]).includes(raw);
}

export async function listIntegrationDocuments(
  workspaceDir: string,
  connectorId: IntegrationConnectorId,
  matterId: string,
): Promise<IntegrationDocumentsResult | IntegrationDocumentsError> {
  const scopeErr = assertMatterScope(workspaceDir, matterId);
  if (scopeErr) {
    return scopeErr;
  }
  const trimmed = matterId.trim();
  const config = loadIntegrationsConfig(workspaceDir);
  const enabled = isConnectorEnabled(config, connectorId);

  if (connectorId === "filesystem") {
    if (!enabled) {
      return { ok: false, error: "connector_disabled", hint: "filesystem 连接器已禁用。" };
    }
    return {
      ok: true,
      connectorId,
      matterId: trimmed,
      documents: listFilesystemDocuments(workspaceDir, trimmed),
    };
  }

  if (!enabled) {
    return stubDocumentsError(connectorId, "disabled");
  }

  if (connectorId === "imanage") {
    const cfg = config.connectors.imanage;
    const docs = listImanageDocuments(workspaceDir, trimmed, cfg);
    if (Array.isArray(docs)) {
      return { ok: true, connectorId, matterId: trimmed, documents: docs };
    }
    return docs;
  }

  if (connectorId === "sharepoint") {
    const cfg = config.connectors.sharepoint;
    const docs = await listSharepointDocuments(workspaceDir, trimmed, cfg);
    if (Array.isArray(docs)) {
      return { ok: true, connectorId, matterId: trimmed, documents: docs };
    }
    return docs;
  }

  return stubDocumentsError(connectorId, "unconfigured");
}

export function buildIntegrationsHealthSummary(workspaceDir: string): {
  connectors: IntegrationConnectorStatus[];
} {
  return { connectors: listIntegrationConnectorStatuses(workspaceDir) };
}
