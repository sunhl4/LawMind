import http from "node:http";
import { sendJsonError } from "./lawmind-api-error.js";
import { handleAuditExportRoute } from "./lawmind-server-route-audit-export.js";
import { handleBootstrapRoute } from "./lawmind-server-route-bootstrap.js";
import { handleChatRoute } from "./lawmind-server-route-chat.js";
import { handleActionSummaryRoutes } from "./lawmind-server-route-action-summary.js";
import { handleAssistantRoutes } from "./lawmind-server-route-assistants.js";
import { handleCollaborationRoutes } from "./lawmind-server-route-collaboration.js";
import { handleJobRoutes } from "./lawmind-server-route-jobs.js";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import { handleHealthRoute } from "./lawmind-server-route-health.js";
import { handleMatterRoutes } from "./lawmind-server-route-matters.js";
import { handleAcceptanceRoutes } from "./lawmind-server-route-acceptance.js";
import { handleOnboardingRoutes } from "./lawmind-server-route-onboarding.js";
import { handleLearningContractRoutes } from "./lawmind-server-route-learning-contract.js";
import { handleContractReviewRoutes } from "./lawmind-server-route-contract-review.js";
import { handleDeskSettingsRoutes } from "./lawmind-server-route-desk-settings.js";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import { handleSessionExtendedRoutes } from "./lawmind-server-route-sessions.js";
import { handleDraftRevisionJobRoute } from "./lawmind-server-route-draft-revision.js";
import { handleReviewRoute } from "./lawmind-server-route-review.js";
import { handleRedlineRoutes } from "./lawmind-server-route-redline.js";
import { handleSearchRoutes } from "./lawmind-server-route-search.js";
import { handlePlatformRoutes } from "./lawmind-server-route-platform.js";
import { handleModelsRoutes } from "./lawmind-server-route-models.js";
import { handleSourceRoutes } from "./lawmind-server-route-sources.js";
import { handleIntegrationsRoutes } from "./lawmind-server-route-integrations.js";
import { handleToolsRegistryRoute } from "./lawmind-server-route-tools-registry.js";
import { handleTemplateRoutes } from "./lawmind-server-route-templates.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import {
  LAWMIND_LOCAL_HOST,
  corsHeaders,
  isLawMindHttpError,
  sendJson,
} from "./lawmind-server-helpers.js";
import { handleMemoryAndTemplateRoutes } from "./lawmind-server-route-memory-templates.js";
import { handleMemorySourceTextRoute } from "./lawmind-server-route-memory-preview.js";
import { handleMemoryAdoptionRoutes } from "./lawmind-server-route-memory-adoption.js";
import { handleRolesRoutes } from "./lawmind-server-route-roles.js";

export async function lawmindHandleHttpRequest(
  ctx: LawmindDispatchContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const origin = req.headers.origin;
  const c = corsHeaders(typeof origin === "string" ? origin : undefined);

  if (req.method === "OPTIONS") {
    res.writeHead(204, c);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${LAWMIND_LOCAL_HOST}`);
  const pathname = url.pathname;

  try {
      if (handleHealthRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleBootstrapRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleTemplateRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleAcceptanceRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleSourceRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (handleIntegrationsRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (handleToolsRegistryRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleDraftRevisionJobRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleRedlineRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleSearchRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleReviewRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleModelsRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleChatRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleActionSummaryRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleAssistantRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleMatterRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleOnboardingRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleDeskSettingsRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleContractReviewRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleLearningContractRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleSessionExtendedRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleRecordRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (handleJobRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleCollaborationRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handlePlatformRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleAuditExportRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleMemoryAndTemplateRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (handleMemorySourceTextRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleMemoryAdoptionRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleRolesRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleFilesystemRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: "not found",
        code: "no_route",
        hint:
          "本机路由未匹配。若刚升级 LawMind，请在工作区根执行 pnpm lawmind:bundle:desktop-server（或 pnpm --filter lawmind-desktop bundle:server）后重启桌面端，或重启当前开发用的本地服务进程。",
      }, c);
  } catch (err) {
    if (isLawMindHttpError(err)) {
      sendJsonError(res, err.status, err.code, err.message, c);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    sendJsonError(res, 500, "internal_error", msg, c);
  }
}
