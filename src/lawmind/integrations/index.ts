export type {
  IntegrationConnectorId,
  IntegrationConnectorPhase,
  IntegrationConnectorRuntimeStatus,
  IntegrationConnectorCatalogEntry,
  IntegrationConnectorStatus,
  IntegrationDocumentEntry,
  IntegrationDocumentsResult,
  IntegrationDocumentsError,
} from "./integration-types.js";
export { INTEGRATION_CONNECTOR_IDS } from "./integration-types.js";
export {
  integrationsConfigPath,
  loadIntegrationsConfig,
  isConnectorEnabled,
  type IntegrationsConfig,
} from "./integration-config.js";
export { listFilesystemDocuments } from "./filesystem-connector.js";
export { listImanageDocuments, imanageConnectorReady } from "./imanage-connector.js";
export { listSharepointDocuments, sharepointConnectorReady } from "./sharepoint-connector.js";
export { listFeishuDocuments, feishuConnectorReady } from "./feishu-connector.js";
export { readMatterDmsMapping, matterDmsMapPath } from "./dms-matter-map.js";
export {
  INTEGRATION_CONNECTOR_CATALOG,
  assertMatterScope,
  listIntegrationConnectorStatuses,
  listIntegrationDocuments,
  buildIntegrationsHealthSummary,
  isKnownConnectorId,
  resolveConnectorStatus,
} from "./integration-registry.js";
