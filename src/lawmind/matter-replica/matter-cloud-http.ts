/**
 * Matter Cloud HTTP handler — PUT/GET ops, materials manifest, blobs.
 * Paths: /v1/matters/:matterId/ops|materials/manifest|blobs/:sha256
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { MatterCloudStore } from "./matter-cloud-store.js";
import type { MatterMaterialEntry, MatterRecordOp } from "./types.js";

export type MatterCloudHttpResult = {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer;
};

function readBody(req: IncomingMessage, limit = 60 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const MATTER_PATH =
  /^\/v1\/matters\/([a-zA-Z0-9_-]{1,128})(?:\/(ops|materials\/manifest|blobs\/([a-fA-F0-9]{64})))?$/;

export function matchMatterCloudPath(pathname: string): {
  matterId: string;
  kind: "ops" | "manifest" | "blob" | "root";
  sha256?: string;
} | null {
  const m = MATTER_PATH.exec(pathname);
  if (!m) {
    return null;
  }
  const matterId = m[1];
  const rest = m[2];
  if (!rest) {
    return { matterId, kind: "root" };
  }
  if (rest === "ops") {
    return { matterId, kind: "ops" };
  }
  if (rest === "materials/manifest") {
    return { matterId, kind: "manifest" };
  }
  if (rest.startsWith("blobs/") && m[3]) {
    return { matterId, kind: "blob", sha256: m[3].toLowerCase() };
  }
  return null;
}

export async function handleMatterCloudRequest(
  store: MatterCloudStore,
  req: IncomingMessage,
  pathname: string,
): Promise<MatterCloudHttpResult | null> {
  const hit = matchMatterCloudPath(pathname);
  if (!hit) {
    return null;
  }
  const method = (req.method ?? "GET").toUpperCase();

  if (hit.kind === "root") {
    return {
      status: 200,
      json: { ok: true, matterId: hit.matterId, service: "lawmind-matter-cloud" },
    };
  }

  if (hit.kind === "ops") {
    if (method === "GET") {
      const ops = store.readOps(hit.matterId);
      if (ops.length === 0) {
        return { status: 404, json: { ok: false, error: "no ops" } };
      }
      return {
        status: 200,
        json: {
          version: 1,
          matterId: hit.matterId,
          publishedAt: new Date().toISOString(),
          ops,
        },
      };
    }
    if (method === "PUT") {
      const raw = JSON.parse((await readBody(req)).toString("utf8")) as {
        ops?: MatterRecordOp[];
      };
      const ops = Array.isArray(raw.ops) ? raw.ops : [];
      const envelope = store.writeOps(hit.matterId, ops);
      return { status: 200, json: envelope };
    }
    return { status: 405, json: { ok: false, error: "method not allowed" } };
  }

  if (hit.kind === "manifest") {
    if (method === "GET") {
      const files = store.readManifest(hit.matterId);
      if (files.length === 0) {
        return { status: 404, json: { ok: false, error: "no manifest" } };
      }
      return {
        status: 200,
        json: {
          version: 1,
          matterId: hit.matterId,
          publishedAt: new Date().toISOString(),
          files,
        },
      };
    }
    if (method === "PUT") {
      const raw = JSON.parse((await readBody(req)).toString("utf8")) as {
        files?: MatterMaterialEntry[];
        removed?: string[];
      };
      const files = Array.isArray(raw.files) ? raw.files : [];
      const removed = Array.isArray(raw.removed)
        ? raw.removed.filter((s) => typeof s === "string")
        : [];
      const envelope = store.writeManifest(hit.matterId, files, removed);
      return { status: 200, json: envelope };
    }
    return { status: 405, json: { ok: false, error: "method not allowed" } };
  }

  if (hit.kind === "blob" && hit.sha256) {
    if (method === "GET") {
      const buf = store.getBlob(hit.matterId, hit.sha256);
      if (!buf) {
        return { status: 404, json: { ok: false, error: "blob not found" } };
      }
      return {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: buf,
      };
    }
    if (method === "PUT") {
      const bytes = await readBody(req);
      const { created } = store.putBlob(hit.matterId, hit.sha256, bytes);
      return {
        status: created ? 201 : 409,
        json: { ok: true, sha256: hit.sha256, created },
      };
    }
    return { status: 405, json: { ok: false, error: "method not allowed" } };
  }

  return { status: 404, json: { ok: false, error: "not found" } };
}

export function sendMatterCloudResult(res: ServerResponse, result: MatterCloudHttpResult): void {
  const headers = { ...result.headers };
  if (result.body) {
    headers["content-length"] = String(result.body.length);
    res.writeHead(result.status, headers);
    res.end(result.body);
    return;
  }
  const payload = JSON.stringify(result.json ?? {});
  headers["content-type"] = "application/json; charset=utf-8";
  headers["content-length"] = Buffer.byteLength(payload).toString();
  res.writeHead(result.status, headers);
  res.end(payload);
}
