import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
} from "../../../src/lawmind/audit/hash-chain.js";
import type { AuditEvent } from "../../../src/lawmind/types.js";
import { handleAuditExportRoute } from "./lawmind-server-route-audit-export.js";
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
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
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

  it("rejects integrity export when edition is solo", async () => {
    delete process.env.LAWMIND_EDITION;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-solo-"));
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
    expect(capture.status).toBe(403);
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
