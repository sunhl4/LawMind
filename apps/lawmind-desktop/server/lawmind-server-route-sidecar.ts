import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_VERBS } from "../../../src/lawmind/desk/verbs.js";
import { productLineOf, resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { ingestSidecarSelection } from "../../../src/lawmind/sidecar/ingest.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

function sidecarWordDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../sidecar/word"),
    path.join(process.cwd(), "apps/lawmind-desktop/sidecar/word"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}

function sendSidecarFile(res: LawmindRouteContext["res"], filename: string, type: string, c: Record<string, string>): boolean {
  const file = path.join(sidecarWordDir(), filename);
  if (!fs.existsSync(file)) {
    return false;
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    ...c,
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
  return true;
}

export async function handleSidecarRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname === "/api/lawmindd" || pathname === "/api/sidecar/status") {
    if (req.method !== "GET") {
      return false;
    }
    const policyForEdition: LawMindWorkspacePolicy | null = ctx.policy.loaded
      ? (ctx.policy.policy as LawMindWorkspacePolicy)
      : null;
    const edition = resolveEdition({ policy: policyForEdition });
    sendJson(
      res,
      200,
      {
        ok: true,
        daemon: "lawmindd",
        ready: true,
        productLine: productLineOf(edition.edition),
        ingestPath: "/api/sidecar/ingest",
        verbs: DESK_VERBS.map((v) => ({ id: v.verb, label: v.label })),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/sidecar/ingest" && req.method === "POST") {
    const body = (await readJsonBody(req)) as {
      source?: string;
      title?: string;
      text?: string;
      verb?: string;
    };
    try {
      const result = ingestSidecarSelection(ctx.workspaceDir, {
        source: body.source,
        title: body.title,
        text: typeof body.text === "string" ? body.text : "",
        verb: body.verb,
      });
      sendJson(res, 200, { ok: true, ...result }, c);
    } catch (err) {
      const code = err instanceof Error ? err.message : "ingest_failed";
      const status = code === "empty_selection" ? 400 : code === "selection_too_large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: code }, c);
    }
    return true;
  }

  if (pathname === "/sidecar/word/taskpane.html" && req.method === "GET") {
    return sendSidecarFile(res, "taskpane.html", "text/html; charset=utf-8", c);
  }
  if (pathname === "/sidecar/word/manifest.xml" && req.method === "GET") {
    return sendSidecarFile(res, "manifest.xml", "application/xml; charset=utf-8", c);
  }

  return false;
}
