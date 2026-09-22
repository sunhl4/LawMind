import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../types.js";
import { AUDIT_CHAIN_KEY_ENV } from "./audit-key.js";
import { AUDIT_EXTERNAL_ANCHOR_URL_ENV } from "./export-summary.js";
import {
  createExternalAnchorUploader,
  FileExternalAnchorUploader,
  HttpPutExternalAnchorUploader,
  syncExternalAnchor,
  syncExternalAnchorForAuditDir,
} from "./external-anchor.js";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";
import { emit, readAuditLog } from "./index.js";
import { appendAuditRootAnchor } from "./root-anchor.js";

const tmpDirs: string[] = [];

function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-external-anchor-"));
  tmpDirs.push(dir);
  return dir;
}

function baseEvent(i: number): AuditEvent {
  return {
    eventId: `e${i}`,
    taskId: `t${i}`,
    kind: "task.created",
    actor: "system",
    timestamp: `2026-05-20T10:00:0${i}.000Z`,
    detail: `detail-${i}`,
  };
}

function appendChained(
  auditDir: string,
  date: string,
  event: AuditEvent,
  key: Buffer,
): AuditEventWithIntegrity {
  const filePath = path.join(auditDir, `${date}.jsonl`);
  const stored = attachHashChain(filePath, event, { key });
  fs.appendFileSync(filePath, `${JSON.stringify(stored)}\n`, "utf8");
  if (stored.eventHash) {
    appendAuditRootAnchor(auditDir, { date, rootHash: stored.eventHash, eventId: stored.eventId });
  }
  return stored;
}

function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        server,
        port,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
    server.on("error", reject);
  });
}

beforeEach(() => {
  resetAuditHashChainStateForTests();
});

afterEach(() => {
  resetAuditHashChainStateForTests();
  delete process.env[AUDIT_EXTERNAL_ANCHOR_URL_ENV];
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("FileExternalAnchorUploader", () => {
  it("writes and reads back a signed summary", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    const key = Buffer.from("ab".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);
    appendChained(auditDir, "2026-08-01", baseEvent(1), key);

    const uploader = createExternalAnchorUploader(
      path.join(outDir, "anchor.json"),
    ) as FileExternalAnchorUploader;
    const summary = {
      dateRange: { from: "a", to: "b" },
      eventCount: 2,
      rootHash: "root",
      hashAlg: "hmac-sha256" as const,
      tailAnchor: null,
      hmacKeyId: "k",
    };
    const result = await uploader.upload(summary, "sig");
    expect(result.ok).toBe(true);

    const read = await uploader.read();
    expect(read).not.toBeNull();
    expect(read?.summary.rootHash).toBe("root");
    expect(read?.signature).toBe("sig");
  });
});

describe("HttpPutExternalAnchorUploader", () => {
  it("PUTs and GETs the signed summary via local http", async () => {
    let storedBody = "";
    const { port, close } = await startHttpServer((req, res) => {
      if (req.method === "PUT") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          storedBody = body;
          res.writeHead(200);
          res.end();
        });
      } else if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(storedBody || "{}");
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    const auditDir = mkTmpDir();
    const key = Buffer.from("cd".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const uploader = new HttpPutExternalAnchorUploader(`http://127.0.0.1:${port}/anchor`, {
      allowInsecure: true,
    });
    const summary = {
      dateRange: { from: "a", to: "b" },
      eventCount: 1,
      rootHash: "root",
      hashAlg: "hmac-sha256" as const,
      tailAnchor: null,
    };
    const result = await uploader.upload(summary, "sig");
    expect(result.ok).toBe(true);

    const read = await uploader.read();
    expect(read?.summary.eventCount).toBe(1);
    expect(read?.signature).toBe("sig");

    await close();
  });

  it("retries transient failures and eventually succeeds", async () => {
    let attempts = 0;
    const { port, close } = await startHttpServer((req, res) => {
      attempts += 1;
      if (req.method === "PUT" && attempts <= 2) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end();
    });

    const auditDir = mkTmpDir();
    const key = Buffer.from("ef".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const uploader = new HttpPutExternalAnchorUploader(`http://127.0.0.1:${port}/anchor`, {
      allowInsecure: true,
    });
    const summary = {
      dateRange: { from: "a", to: "b" },
      eventCount: 1,
      rootHash: "root",
      hashAlg: "hmac-sha256" as const,
      tailAnchor: null,
    };
    const result = await uploader.upload(summary, "sig");
    expect(result.ok).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(3);

    await close();
  }, 10_000);
});

describe("syncExternalAnchor", () => {
  it("returns skipped when URL is not configured", async () => {
    const auditDir = mkTmpDir();
    const result = await syncExternalAnchor(auditDir, undefined);
    expect(result.ok).toBe(true);
    expect("skipped" in result && result.skipped).toBe(true);
  });

  it("writes signed summary to file and does not throw on bad URL", async () => {
    const auditDir = mkTmpDir();
    const key = Buffer.from("12".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const bad = await syncExternalAnchor(auditDir, "http://127.0.0.1:1/no-such-server");
    expect(bad.ok).toBe(false);
    expect("error" in bad && bad.error).toContain("http_put_error");

    const outDir = mkTmpDir();
    const good = await syncExternalAnchor(auditDir, path.join(outDir, "anchor.json"));
    expect(good.ok).toBe(true);
    expect(fs.existsSync(path.join(outDir, "anchor.json"))).toBe(true);
  });

  it("reads external URL from env var", async () => {
    const auditDir = mkTmpDir();
    const outDir = mkTmpDir();
    process.env[AUDIT_EXTERNAL_ANCHOR_URL_ENV] = path.join(outDir, "env-anchor.json");
    const key = Buffer.from("34".repeat(32), "hex");
    appendChained(auditDir, "2026-08-01", baseEvent(0), key);

    const result = await syncExternalAnchorForAuditDir(auditDir, { key });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(outDir, "env-anchor.json"))).toBe(true);
  });

  it("does not block emit when external anchor fails", async () => {
    const auditDir = mkTmpDir();
    process.env[AUDIT_EXTERNAL_ANCHOR_URL_ENV] = "http://127.0.0.1:1/bad";
    const keyHex = "ff".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = keyHex;

    await emit(auditDir, {
      taskId: "t",
      kind: "task.created",
      actor: "system",
      integrityChain: true,
    });

    const events = await readAuditLog(auditDir);
    expect(events.length).toBe(1);
  });
});
