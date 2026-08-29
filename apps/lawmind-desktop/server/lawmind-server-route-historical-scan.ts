/**
 * Historical corpus scan:
 *   GET  /api/historical-scan
 *   POST /api/historical-scan/roots
 *   POST /api/historical-scan/roots/remove
 *   POST /api/historical-scan/run
 */

import { z } from "zod";
import {
  addScanRoot,
  listScanRoots,
  readLatestScanJob,
  removeScanRoot,
  runHistoricalScan,
} from "../../../src/lawmind/historical-scan/index.js";
import { persistNorthStarSnapshot } from "../../../src/lawmind/metrics/north-star.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const addRootSchema = z.object({
  absPath: z.string().min(1).max(1024),
  label: z.string().max(120).optional(),
});

const removeRootSchema = z.object({
  rootId: z.string().min(1).max(80),
});

const runSchema = z.object({
  rootIds: z.array(z.string().min(1)).max(3).optional(),
  incremental: z.boolean().optional(),
});

export async function handleHistoricalScanRoutes({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/historical-scan" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        ok: true,
        roots: listScanRoots(workspaceDir),
        latest: readLatestScanJob(workspaceDir),
        northStar: persistNorthStarSnapshot(workspaceDir),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/historical-scan/roots" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, addRootSchema);
      const added = addScanRoot(workspaceDir, body.absPath, body.label);
      if (!added.ok) {
        sendJson(res, 400, { ok: false, error: added.error }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, root: added.root, roots: listScanRoots(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/historical-scan/roots/remove" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, removeRootSchema);
      const removed = removeScanRoot(workspaceDir, body.rootId);
      sendJson(res, 200, { ok: true, removed, roots: listScanRoots(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/historical-scan/run" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, runSchema);
      const job = await runHistoricalScan(workspaceDir, {
        rootIds: body.rootIds,
        incremental: body.incremental,
      });
      sendJson(res, 200, { ok: true, job }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  return false;
}
