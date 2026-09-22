/**
 * Workspace integration connector config (`lawmind/integrations.json`).
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { IntegrationConnectorId } from "./integration-types.js";

const connectorEntrySchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  tenantId: z.string().optional(),
  clientId: z.string().optional(),
  note: z.string().optional(),
});

const integrationsFileSchema = z.object({
  connectors: z.record(z.string(), connectorEntrySchema).optional(),
});

export type IntegrationConnectorConfigEntry = z.infer<typeof connectorEntrySchema>;

export type IntegrationsConfig = {
  connectors: Partial<Record<IntegrationConnectorId, IntegrationConnectorConfigEntry>>;
};

export function integrationsConfigPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "integrations.json");
}

export function loadIntegrationsConfig(workspaceDir: string): IntegrationsConfig {
  const filePath = integrationsConfigPath(workspaceDir);
  if (!fs.existsSync(filePath)) {
    return { connectors: { filesystem: { enabled: true } } };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const parsed = integrationsFileSchema.safeParse(raw);
    if (!parsed.success) {
      return { connectors: { filesystem: { enabled: true } } };
    }
    const connectors = parsed.data.connectors ?? {};
    return {
      connectors: connectors as IntegrationsConfig["connectors"],
    };
  } catch {
    return { connectors: { filesystem: { enabled: true } } };
  }
}

export function isConnectorEnabled(
  config: IntegrationsConfig,
  connectorId: IntegrationConnectorId,
): boolean {
  const entry = config.connectors[connectorId];
  if (connectorId === "filesystem") {
    return entry?.enabled !== false;
  }
  return entry?.enabled === true;
}
