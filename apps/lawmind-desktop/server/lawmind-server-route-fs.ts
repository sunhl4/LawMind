import fs from "node:fs";
import path from "node:path";
import { ensureLocalFileSync } from "../../../src/lawmind/runtime/icloud-materialize.js";
import {
  PROTECTED_WORKSPACE_WRITE_CODE,
  PROTECTED_WORKSPACE_WRITE_REFUSAL,
  isProtectedWorkspaceRel,
} from "../../../src/lawmind/runtime/protected-workspace-rels.js";
import { parseJsonBodyZod } from "./lawmind-api-parse.js";
import { fsWritePostSchema } from "./lawmind-api-schemas.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import {
  MAX_TEXT_READ_BYTES,
  FsWriteNotAllowedError,
  isLikelyBinary,
  normalizeRelPath,
  resolveFsPath,
  resolveFsRoots,
  safeArtifactPath,
  sendJson,
} from "./lawmind-server-helpers.js";

export async function handleFilesystemRoute({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/artifact" && req.method === "GET") {
    const rel = url.searchParams.get("path") ?? "";
    const full = safeArtifactPath(workspaceDir, rel);
    if (!full || !fs.existsSync(full)) {
      sendJson(res, 404, { ok: false, error: "not found" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const buf = await fs.promises.readFile(full);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": `inline; filename="${path.basename(full)}"`,
      ...c,
    });
    res.end(buf);
    return true;
  }

  if (pathname === "/api/fs/tree" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    const { full, rel } = resolveFsPath(roots, root, relPath, { access: "read" });
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) {
      sendJson(res, 400, { ok: false, error: "path is not directory" }, c);
      return true;
    }
    const entries = fs
      .readdirSync(full, { withFileTypes: true })
      .map((entry) => {
        const childRel = normalizeRelPath(path.join(rel, entry.name));
        const childAbs = path.join(full, entry.name);
        const childStat = fs.statSync(childAbs);
        return {
          name: entry.name,
          path: childRel,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? undefined : childStat.size,
          mtimeMs: childStat.mtimeMs,
        };
      })
      .toSorted((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    sendJson(res, 200, { ok: true, entries }, c);
    return true;
  }

  if (pathname === "/api/fs/read" && req.method === "GET") {
    const roots = resolveFsRoots(workspaceDir);
    const root = url.searchParams.get("root") ?? "workspace";
    const relPath = url.searchParams.get("path") ?? "";
    const { full } = resolveFsPath(roots, root, relPath, { access: "read" });
    const stat = fs.statSync(full);
    if (!stat.isFile()) {
      sendJson(res, 400, { ok: false, error: "path is not file" }, c);
      return true;
    }
    if (stat.size > MAX_TEXT_READ_BYTES) {
      sendJson(res, 413, { ok: false, error: "file too large" }, c);
      return true;
    }
    ensureLocalFileSync(full);
    const buf = fs.readFileSync(full);
    if (isLikelyBinary(buf)) {
      sendJson(res, 415, { ok: false, error: "binary file is not supported" }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        content: buf.toString("utf8"),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/fs/write" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, fsWritePostSchema);
    const roots = resolveFsRoots(workspaceDir);
    const root = body.root ?? "workspace";
    const relPath = body.path ?? "";
    const content = body.content ?? "";
    const expectedMtimeMs = body.expectedMtimeMs;
    // 写门禁在 resolveFsPath 的 write 分支里（可写根白名单，挂载点只读），
    // 与本机能力网关的 write_forbidden 同口径。
    let resolved: { full: string; rel: string };
    try {
      resolved = resolveFsPath(roots, root, relPath, { access: "write" });
    } catch (err) {
      if (err instanceof FsWriteNotAllowedError) {
        sendJson(res, 403, { ok: false, code: err.code, error: err.message }, c);
        return true;
      }
      throw err;
    }
    const { full, rel } = resolved;
    if (root === "workspace" && isProtectedWorkspaceRel(rel)) {
      sendJson(
        res,
        403,
        {
          ok: false,
          code: PROTECTED_WORKSPACE_WRITE_CODE,
          error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
        },
        c,
      );
      return true;
    }

    let priorMtime: number | undefined;
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      if (!stat.isFile()) {
        sendJson(res, 400, { ok: false, error: "path is not file" }, c);
        return true;
      }
      priorMtime = stat.mtimeMs;
      if (expectedMtimeMs !== undefined && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        sendJson(
          res,
          409,
          { ok: false, conflict: true, error: "file was modified externally", mtimeMs: stat.mtimeMs },
          c,
        );
        return true;
      }
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
    }

    fs.writeFileSync(full, content, "utf8");
    const next = fs.statSync(full);
    ctx.sseBus?.emit({
      type: "fs:change",
      data: { root, rel, mtimeMs: next.mtimeMs, size: next.size },
    });
    sendJson(
      res,
      200,
      { ok: true, mtimeMs: next.mtimeMs, size: next.size, previousMtimeMs: priorMtime },
      c,
    );
    return true;
  }

  return false;
}
