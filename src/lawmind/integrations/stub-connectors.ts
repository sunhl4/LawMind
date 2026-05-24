/**
 * Placeholder DMS connectors — catalog only until Firm API credentials are configured.
 */

import type { IntegrationConnectorId, IntegrationDocumentsError } from "./integration-types.js";

const STUB_HINTS: Record<Exclude<IntegrationConnectorId, "filesystem">, string> = {
  imanage: "在 lawmind/integrations.json 启用并配置 baseUrl；需 Firm 版 API 密钥（host vault）。",
  netdocuments: "在 lawmind/integrations.json 启用；需 NetDocuments OAuth（M3 门控回写）。",
  sharepoint: "在 lawmind/integrations.json 启用；需 Microsoft Graph tenantId（M2 只读索引）。",
};

export function stubDocumentsError(
  connectorId: Exclude<IntegrationConnectorId, "filesystem">,
  reason: "disabled" | "unconfigured",
): IntegrationDocumentsError {
  return {
    ok: false,
    error: reason === "disabled" ? "connector_disabled" : "connector_unconfigured",
    hint: STUB_HINTS[connectorId],
  };
}
