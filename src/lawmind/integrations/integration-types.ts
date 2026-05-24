/**
 * M2 read-only integration connectors (DMS / workspace index POC).
 */

export const INTEGRATION_CONNECTOR_IDS = [
  "filesystem",
  "imanage",
  "netdocuments",
  "sharepoint",
] as const;

export type IntegrationConnectorId = (typeof INTEGRATION_CONNECTOR_IDS)[number];

export type IntegrationConnectorPhase = "M1" | "M2" | "M3";

export type IntegrationConnectorRuntimeStatus = "active" | "disabled" | "unconfigured";

export type IntegrationConnectorCatalogEntry = {
  id: IntegrationConnectorId;
  label: string;
  phase: IntegrationConnectorPhase;
  description: string;
};

export type IntegrationConnectorStatus = IntegrationConnectorCatalogEntry & {
  status: IntegrationConnectorRuntimeStatus;
  hint?: string;
};

export type IntegrationDocumentEntry = {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  source: IntegrationConnectorId;
};

export type IntegrationDocumentsResult = {
  ok: true;
  connectorId: IntegrationConnectorId;
  matterId: string;
  documents: IntegrationDocumentEntry[];
};

export type IntegrationDocumentsError = {
  ok: false;
  error: string;
  hint?: string;
};
