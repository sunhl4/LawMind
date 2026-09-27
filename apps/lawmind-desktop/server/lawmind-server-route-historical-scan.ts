/**
 * Historical corpus scan:
 *   GET  /api/historical-scan
 *   POST /api/historical-scan/roots
 *   POST /api/historical-scan/roots/remove
 *   POST /api/historical-scan/run
 *   POST /api/historical-scan/file
 *   POST /api/historical-scan/apply
 *   POST /api/historical-scan/common-places
 */

import { z } from "zod";
import {
  addScanRoot,
  applyScanPlan,
  buildScanPlan,
  fileScanIntoMatters,
  listScanRoots,
  readLatestScanJob,
  removeScanRoot,
  replaceWithCommonPlaces,
  runHistoricalScan,
} from "../../../src/lawmind/historical-scan/index.js";
import { persistNorthStarSnapshot } from "../../../src/lawmind/metrics/north-star.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

async function safeScanPlan(workspaceDir: string) {
  try {
    return await buildScanPlan(workspaceDir);
  } catch {
    return null;
  }
}

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

const fileSchema = z.object({
  labels: z.array(z.string().min(1).max(128)).min(1).max(40),
});

const applySchema = z.object({
  createLabels: z.array(z.string().min(1).max(128)).max(40),
  intoMatterIds: z.array(z.string().min(1).max(128)).max(40),
  libraryKinds: z.array(z.string().min(1).max(40)).max(8),
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
        plan: await safeScanPlan(workspaceDir),
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
      sendJson(res, 200, { ok: true, job, plan: await safeScanPlan(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/historical-scan/common-places" && req.method === "POST") {
    const roots = replaceWithCommonPlaces(workspaceDir);
    sendJson(res, 200, { ok: true, roots }, c);
    return true;
  }

  if (pathname === "/api/historical-scan/apply" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, applySchema);
      const applied = await applyScanPlan(workspaceDir, body);
      if (!applied.ok) {
        sendJson(res, 400, { ok: false, error: applied.error, hint: "请先查看这些文件夹。" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, ...applied, plan: await safeScanPlan(workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  // 整理资料页现在只调用 /apply。这一条是「按标注收进案件」的接口，留给以后的内置步骤。
  if (pathname === "/api/historical-scan/file" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, fileSchema);
      const filed = await fileScanIntoMatters(workspaceDir, body.labels);
      if (!filed.ok) {
        sendJson(res, 400, { ok: false, error: filed.error, hint: "请先整理一次，再收进案件。" }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, ...filed.result }, c);
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
