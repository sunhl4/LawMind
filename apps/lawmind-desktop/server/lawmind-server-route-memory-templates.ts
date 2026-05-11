import fs from "node:fs";
import path from "node:path";
import { listAssistantProfileSections } from "../../../src/lawmind/assistants/profile-md.js";
import {
  buildAgentMemorySourceReport,
  loadMemoryContext,
  toEngineClientMemorySnapshot,
} from "../../../src/lawmind/memory/index.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { listBuiltInTemplates } from "../../../src/lawmind/templates/index.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

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

/**
 * GET /api/templates/built-in
 * GET /api/memory/sources
 * GET /api/memory/adoptions
 */
export async function handleMemoryAndTemplateRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;

  if (pathname === "/api/templates/built-in" && req.method === "GET") {
    sendJson(res, 200, { ok: true, templates: listBuiltInTemplates() }, c);
    return true;
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
    return true;
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
    return true;
  }

  return false;
}
