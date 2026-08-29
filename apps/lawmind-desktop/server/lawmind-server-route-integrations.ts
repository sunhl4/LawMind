/**
 * M2 read-only integration connectors.
 *
 *   GET /api/integrations
 *   GET /api/integrations/:connectorId/documents?matterId=
 */

import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import {
  isKnownConnectorId,
  listIntegrationConnectorStatuses,
  listIntegrationDocuments,
} from "../../../src/lawmind/integrations/index.js";

export async function handleIntegrationsRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }

  const { workspaceDir } = ctx;

  if (pathname === "/api/integrations") {
    sendJson(res, 200, {
      ok: true,
      connectors: listIntegrationConnectorStatuses(workspaceDir),
    }, c);
    return true;
  }

  const docMatch = pathname.match(/^\/api\/integrations\/([^/]+)\/documents$/);
  if (!docMatch) {
    return false;
  }

  const connectorId = decodeURIComponent(docMatch[1] ?? "");
  if (!isKnownConnectorId(connectorId)) {
    sendJson(res, 404, { ok: false, error: "unknown_connector" }, c);
    return true;
  }

  const matterId = url.searchParams.get("matterId") ?? "";
  const result = await listIntegrationDocuments(workspaceDir, connectorId, matterId);
  if (!result.ok) {
    const status =
      result.error === "matter_id_required" || result.error === "invalid_matter_id"
        ? 400
        : result.error === "matter_not_found"
          ? 404
          : result.error === "connector_disabled" || result.error === "connector_unconfigured"
            ? 503
            : 400;
    sendJson(res, status, result, c);
    return true;
  }

  sendJson(res, 200, result, c);
  return true;
}
