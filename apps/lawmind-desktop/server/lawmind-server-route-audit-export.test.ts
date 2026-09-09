import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
} from "../../../src/lawmind/audit/hash-chain.js";
import { emit } from "../../../src/lawmind/audit/index.js";
import type { AuditEvent } from "../../../src/lawmind/types.js";
import { exportAuditSummaryToFile } from "../../../src/lawmind/audit/export-summary.js";
import { AUDIT_CHAIN_KEY_ENV } from "../../../src/lawmind/audit/audit-key.js";
import { resetLocalKeyStoreCacheForTests } from "../../../src/lawmind/platform/local-key-store.js";
import {
  handleAuditExportRoute,
  handleAuditExportSummaryRoute,
  handleAuditVerifyExternalRoute,
} from "./lawmind-server-route-audit-export.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    end(chunk?: string | Buffer) {
      body += chunk ? chunk.toString() : "";
      return this;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

afterEach(() => {
  resetLocalKeyStoreCacheForTests();
  delete process.env[AUDIT_CHAIN_KEY_ENV];
});

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: { "content-type": "application/json" } } as http.IncomingMessage;
  Object.assign(req, {
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === "data" && body !== undefined) {
        fn(Buffer.from(JSON.stringify(body)));
      }
      if (ev === "end") {
        fn();
      }
      return req;
    },
  });
  return req;
}

function baseEvent(i: number): AuditEvent {
  return {
    eventId: `ev-${i}`,
    taskId: `task-${i}`,
    kind: "task.created",
    actor: "system",
    timestamp: `2026-05-20T12:00:0${i}.000Z`,
    detail: `d${i}`,
  };
}

describe("lawmind-server-route-audit-export integrity", () => {
  const prevEdition = process.env.LAWMIND_EDITION;

  afterEach(() => {
    resetAuditHashChainStateForTests();
    if (prevEdition === undefined) {
      delete process.env.LAWMIND_EDITION;
    } else {
      process.env.LAWMIND_EDITION = prevEdition;
    }
  });

  it("GET ?integrity=true returns chain summary for firm edition", async () => {
    process.env.LAWMIND_EDITION = "firm";
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-int-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const auditFile = path.join(auditDir, "2026-05-20.jsonl");
    const lines = [0, 1, 2].map((i) => JSON.stringify(attachHashChain(auditFile, baseEvent(i))));
    fs.writeFileSync(auditFile, `${lines.join("\n")}\n`, "utf8");

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export?integrity=true"),
      pathname: "/api/audit/export",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    expect(body.ok).toBe(true);
    const integrity = body.integrity as { ok: boolean; chainedCount: number };
    expect(integrity.ok).toBe(true);
    expect(integrity.chainedCount).toBe(3);
  });

  it("integrity response surfaces tail truncation via root anchor", async () => {
    process.env.LAWMIND_EDITION = "firm";
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-anchor-"));
    const auditDir = path.join(workspaceDir, "audit");
    // 真实 emit 路径：写链 + 外锚。
    for (let i = 0; i < 3; i++) {
      await emit(auditDir, {
        taskId: `t${i}`,
        kind: "task.created",
        actor: "system",
        integrityChain: true,
      });
    }
    // 尾部截断：删掉最后一条链上事件。
    const dayFile = fs.readdirSync(auditDir).find((n) => n.endsWith(".jsonl"));
    expect(dayFile).toBeTruthy();
    const filePath = path.join(auditDir, dayFile ?? "");
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(filePath, `${lines.slice(0, 2).join("\n")}\n`, "utf8");

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export?integrity=true"),
      pathname: "/api/audit/export",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    const integrity = body.integrity as {
      ok: boolean;
      tailAnchor: { ok: boolean; truncatedDays: string[]; checkedDays: number };
    };
    expect(integrity.tailAnchor.ok).toBe(false);
    expect(integrity.tailAnchor.truncatedDays).toHaveLength(1);
    expect(integrity.tailAnchor.checkedDays).toBe(1);
  });

  it("allows integrity export on Solo edition (trust packaging)", async () => {
    delete process.env.LAWMIND_EDITION;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-solo-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(path.join(auditDir, "events.jsonl"), "", "utf8");
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export?integrity=true"),
      pathname: "/api/audit/export",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
  });
});

describe("lawmind-server-route-audit-export replay", () => {
  it("GET ?replay=true returns JSON replay object", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-replay-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const ev = {
      eventId: "ev-r1",
      taskId: "task-replay-1",
      kind: "task.created" as const,
      actor: "system" as const,
      timestamp: "2026-05-20T14:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(auditDir, "2026-05-20.jsonl"),
      `${JSON.stringify(ev)}\n`,
      "utf8",
    );
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export?replay=true&taskId=task-replay-1"),
      pathname: "/api/audit/export",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    expect(body.ok).toBe(true);
    const replay = body.replay as { schemaVersion: number; events: unknown[] };
    expect(replay.schemaVersion).toBe(1);
    expect(replay.events.length).toBe(1);
  });
});

describe("handleAuditExportSummaryRoute", () => {
  it("GET returns JSON summary and signature", async () => {
    const envKey = "ab".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envKey;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-summary-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const key = Buffer.from(envKey, "hex");
    const auditFile = path.join(auditDir, "2026-05-20.jsonl");
    fs.writeFileSync(
      auditFile,
      [
        JSON.stringify(attachHashChain(auditFile, baseEvent(0), { key })),
        JSON.stringify(attachHashChain(auditFile, baseEvent(1), { key })),
      ].join("\n") + "\n",
      "utf8",
    );

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportSummaryRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export-summary"),
      pathname: "/api/audit/export-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    expect(body.ok).toBe(true);
    expect((body.summary as { eventCount: number }).eventCount).toBe(2);
    expect(typeof body.signature).toBe("string");
    expect(body.signature).toHaveLength(64);
    expect(body.hmacKeyId).toBe("audit-chain");
  });

  it("GET ?format=text returns plain text summary", async () => {
    const envKey = "cd".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envKey;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-summary-txt-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const key = Buffer.from(envKey, "hex");
    const auditFile = path.join(auditDir, "2026-05-20.jsonl");
    fs.writeFileSync(auditFile, `${JSON.stringify(attachHashChain(auditFile, baseEvent(0), { key }))}\n`, "utf8");

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditExportSummaryRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/export-summary?format=text"),
      pathname: "/api/audit/export-summary",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.body).toContain("LawMind Audit Summary");
    expect(capture.body).toContain("Signature:");
  });
});

describe("handleAuditVerifyExternalRoute", () => {
  it("POST verify returns ok when chain and external anchor match", async () => {
    const envKey = "ef".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envKey;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-verify-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const key = Buffer.from(envKey, "hex");
    const auditFile = path.join(auditDir, "2026-05-20.jsonl");
    fs.writeFileSync(
      auditFile,
      [
        JSON.stringify(attachHashChain(auditFile, baseEvent(0), { key })),
        JSON.stringify(attachHashChain(auditFile, baseEvent(1), { key })),
      ].join("\n") + "\n",
      "utf8",
    );
    const anchorPath = path.join(workspaceDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditVerifyExternalRoute({
      ctx,
      req: jsonReq("POST", { externalAnchorUrl: anchorPath }),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/verify-external"),
      pathname: "/api/audit/verify-external",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ok");
    expect(body.report).toContain("结论：通过");
  });

  it("POST detect truncated chain", async () => {
    const envKey = "12".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envKey;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-verify-trunc-"));
    const auditDir = path.join(workspaceDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const key = Buffer.from(envKey, "hex");
    const auditFile = path.join(auditDir, "2026-05-20.jsonl");
    fs.writeFileSync(
      auditFile,
      [
        JSON.stringify(attachHashChain(auditFile, baseEvent(0), { key })),
        JSON.stringify(attachHashChain(auditFile, baseEvent(1), { key })),
      ].join("\n") + "\n",
      "utf8",
    );
    const anchorPath = path.join(workspaceDir, "anchor.json");
    exportAuditSummaryToFile(auditDir, anchorPath, { key });

    // 截断链尾。
    const lines = fs.readFileSync(auditFile, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(auditFile, `${lines[0]}\n`, "utf8");

    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const handled = await handleAuditVerifyExternalRoute({
      ctx,
      req: jsonReq("POST", { externalAnchorUrl: anchorPath }),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/audit/verify-external"),
      pathname: "/api/audit/verify-external",
      c: {},
    });
    expect(handled).toBe(true);
    const body = capture.json();
    expect(body.status).toBe("truncated");
    expect(body.ok).toBe(false);
  });
});
