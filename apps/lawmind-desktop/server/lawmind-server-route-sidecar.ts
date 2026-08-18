import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_VERBS } from "../../../src/lawmind/desk/verbs.js";
import { productLineOf, resolveEdition } from "../../../src/lawmind/policy/edition.js";
import type { LawMindWorkspacePolicy } from "../../../src/lawmind/policy/workspace-policy.js";
import { DEFAULT_LAWMIDD_PORT } from "../../../src/lawmind/sidecar/advertise.js";
import {
  acknowledgeSidecarIngest,
  ingestSidecarSelection,
  listPendingSidecarIngests,
} from "../../../src/lawmind/sidecar/ingest.js";
import {
  acknowledgeSidecarOutbox,
  readSidecarOutbox,
} from "../../../src/lawmind/sidecar/outbox.js";
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

function listenPort(): string {
  const raw = process.env.LAWMIND_DESKTOP_PORT?.trim();
  return raw && /^\d+$/.test(raw) ? raw : String(DEFAULT_LAWMIDD_PORT);
}

function sendSidecarFile(
  res: LawmindRouteContext["res"],
  filename: string,
  type: string,
  c: Record<string, string>,
): boolean {
  const file = path.join(sidecarWordDir(), filename);
  if (!fs.existsSync(file)) {
    return false;
  }
  let body: Buffer | string = fs.readFileSync(file);
  const port = listenPort();
  if (filename === "taskpane.html") {
    body = body
      .toString("utf8")
      .replace(/window\.LAWMIDD_PORT\s*=\s*window\.LAWMIDD_PORT\s*\|\|\s*""\s*;/, `window.LAWMIDD_PORT = ${JSON.stringify(port)};`);
  }
  if (filename === "manifest.xml") {
    body = body.toString("utf8").replace(/127\.0\.0\.1:\d+/g, `127.0.0.1:${port}`);
  }
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
        pendingPath: "/api/sidecar/pending",
        outboxPath: "/api/sidecar/outbox",
        port: Number(listenPort()),
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

  if (pathname === "/api/sidecar/pending" && req.method === "GET") {
    sendJson(res, 200, { ok: true, items: listPendingSidecarIngests(ctx.workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/sidecar/pending/ack" && req.method === "POST") {
    const body = (await readJsonBody(req)) as { relativePath?: string };
    try {
      const result = acknowledgeSidecarIngest(
        ctx.workspaceDir,
        typeof body.relativePath === "string" ? body.relativePath : "",
      );
      sendJson(res, 200, { ok: true, ...result }, c);
    } catch (err) {
      const code = err instanceof Error ? err.message : "ack_failed";
      const status = code === "sidecar_not_found" ? 404 : 400;
      sendJson(res, status, { ok: false, error: code }, c);
    }
    return true;
  }

  if (pathname === "/api/sidecar/outbox" && req.method === "GET") {
    sendJson(res, 200, { ok: true, item: readSidecarOutbox(ctx.workspaceDir) ?? null }, c);
    return true;
  }

  if (pathname === "/api/sidecar/outbox/ack" && req.method === "POST") {
    const item = acknowledgeSidecarOutbox(ctx.workspaceDir);
    if (!item) {
      sendJson(res, 404, { ok: false, error: "outbox_empty" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, item }, c);
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
