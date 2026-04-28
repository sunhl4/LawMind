import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  isValidMatterId,
} from "../../../src/lawmind/cases/index.js";
import {
  buildAgentMemorySourceReport,
  loadMemoryContext,
  toEngineClientMemorySnapshot,
} from "../../../src/lawmind/memory/index.js";
import { listAssistantProfileSections } from "../../../src/lawmind/assistants/profile-md.js";
import { buildAuditExportMarkdown, buildComplianceAuditMarkdown } from "../../../src/lawmind/audit/index.js";
import { listBuiltInTemplates } from "../../../src/lawmind/templates/index.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { sendJsonError } from "./lawmind-api-error.js";
import { handleChatRoute } from "./lawmind-server-route-chat.js";
import { handleAssistantRoutes } from "./lawmind-server-route-assistants.js";
import { handleCollaborationRoutes } from "./lawmind-server-route-collaboration.js";
import { handleJobRoutes } from "./lawmind-server-route-jobs.js";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import { handleHealthRoute } from "./lawmind-server-route-health.js";
import { handleMatterRoutes } from "./lawmind-server-route-matters.js";
import { handleAcceptanceRoutes } from "./lawmind-server-route-acceptance.js";
import { handleOnboardingRoutes } from "./lawmind-server-route-onboarding.js";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import { handleReviewRoute } from "./lawmind-server-route-review.js";
import { handleSourceRoutes } from "./lawmind-server-route-sources.js";
import { handleTemplateRoutes } from "./lawmind-server-route-templates.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import {
  LAWMIND_LOCAL_HOST,
  corsHeaders,
  isLawMindHttpError,
  sendJson,
} from "./lawmind-server-helpers.js";

type MemoryAdoptionRecord = {
  target: "lawyer" | "assistant";
  stamp: string;
  body: string;
};

function listLawyerProfileAdoptions(workspaceDir: string): MemoryAdoptionRecord[] {
  const p = path.join(workspaceDir, "LAWYER_PROFILE.md");
  try {
    const raw = fs.readFileSync(p, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("认知升级建议："))
      .map((line) => {
        const m = /^-\s+\[([^\]]+)\]\s+\[source:[^\]]+\]\s+(.+)$/.exec(line);
        return {
          target: "lawyer" as const,
          stamp: m?.[1]?.trim() ?? "",
          body: m?.[2]?.trim() ?? line,
        };
      });
  } catch {
    return [];
  }
}

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
  const { workspaceDir, envFile } = ctx;

  try {
      if (handleHealthRoute({ ctx, req, res, url, pathname, c })) {
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

      if (await handleReviewRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleChatRoute({ ctx, req, res, url, pathname, c })) {
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

      if (await handleRecordRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (handleJobRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (await handleCollaborationRoutes({ ctx, req, res, url, pathname, c })) {
        return;
      }

      if (pathname === "/api/audit/export" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        const taskId = url.searchParams.get("taskId")?.trim() || undefined;
        const since = url.searchParams.get("since")?.trim() || undefined;
        const until = url.searchParams.get("until")?.trim() || undefined;
        if (matterId && !isValidMatterId(matterId)) {
          sendJson(res, 400, { ok: false, error: "invalid matter id" }, c);
          return;
        }
        const complianceRaw = url.searchParams.get("compliance")?.trim().toLowerCase() ?? "";
        const useCompliance = complianceRaw === "1" || complianceRaw === "true";
        const md = useCompliance
          ? await buildComplianceAuditMarkdown(workspaceDir, { matterId, taskId, since, until })
          : await buildAuditExportMarkdown(workspaceDir, { matterId, taskId, since, until });
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          ...c,
        });
        res.end(md);
        return;
      }

      if (pathname === "/api/templates/built-in" && req.method === "GET") {
        sendJson(res, 200, { ok: true, templates: listBuiltInTemplates() }, c);
        return;
      }

      if (pathname === "/api/memory/sources" && req.method === "GET") {
        const matterId = url.searchParams.get("matterId")?.trim() || undefined;
        const assistantId = url.searchParams.get("assistantId")?.trim() || undefined;
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const engineMem = await loadMemoryContext(workspaceDir, { matterId });
        const memorySources = await buildAgentMemorySourceReport(workspaceDir, {
          matterId,
          assistantId,
          lawMindRoot,
          engineMemory: toEngineClientMemorySnapshot(engineMem),
        });
        sendJson(res, 200, { ok: true, memorySources }, c);
        return;
      }

      if (pathname === "/api/memory/adoptions" && req.method === "GET") {
        const assistantId = url.searchParams.get("assistantId")?.trim() || "";
        const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
        const lawyer = listLawyerProfileAdoptions(workspaceDir);
        const assistant = assistantId
          ? listAssistantProfileSections(lawMindRoot, assistantId)
              .filter((section) => section.body.includes("认知升级建议："))
              .map((section) => ({
                target: "assistant" as const,
                stamp: section.stamp,
                body: section.body,
              }))
          : [];
        const items = [...lawyer, ...assistant]
          .toSorted((a, b) => b.stamp.localeCompare(a.stamp))
          .slice(0, 40);
        sendJson(res, 200, { ok: true, items }, c);
        return;
      }

      if (await handleFilesystemRoute({ ctx, req, res, url, pathname, c })) {
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" }, c);
  } catch (err) {
    if (isLawMindHttpError(err)) {
      sendJsonError(res, err.status, err.code, err.message, c);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    sendJsonError(res, 500, "internal_error", msg, c);
  }
}
