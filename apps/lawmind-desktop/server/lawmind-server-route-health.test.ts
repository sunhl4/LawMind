import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LAWMIND_AGENT_BEHAVIOR_EPOCH } from "../../../src/lawmind/agent/system-prompt.js";
import { handleHealthRoute } from "./lawmind-server-route-health.js";
import type { LawMindPolicyFile } from "./lawmind-policy.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = "";
  const res = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
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
    get headers() {
      return headers;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

describe("lawmind-server-route-health", () => {
  const prevRepoRoot = process.env.LAWMIND_REPO_ROOT;

  afterEach(() => {
    if (prevRepoRoot === undefined) {
      delete process.env.LAWMIND_REPO_ROOT;
    } else {
      process.env.LAWMIND_REPO_ROOT = prevRepoRoot;
    }
  });

  it("returns false for non-health routes", () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    const handled = handleHealthRoute({
      ctx,
      req: { method: "POST" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/other"),
      pathname: "/api/other",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("returns health payload for GET /api/health", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-route-"));
    const userEnvPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(userEnvPath, "LAWMIND_AGENT_MODEL=test-model\n", "utf8");
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: userEnvPath,
      userEnvPath,
      policy: { loaded: false },
    };

    const handled = handleHealthRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/health"),
      pathname: "/api/health",
      c: { "x-test": "1" },
    });

    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.headers["x-test"]).toBe("1");
    const payload = capture.json();
    expect(payload).toMatchObject({
      ok: true,
      lawmindAgentBehaviorEpoch: LAWMIND_AGENT_BEHAVIOR_EPOCH,
      lawmindClarificationProtocol: "v1",
      agentMandatoryRulesActive: false,
      agentMandatoryRulesTruncated: false,
      edition: {
        id: "solo",
        source: "default",
      },
      workspaceDir,
      envHint: {
        userDataEnvPath: userEnvPath,
        userDataEnvExists: true,
      },
    });
    expect(typeof payload.lawmindRouterMode).toBe("string");
    expect((payload.lawmindRouterMode as string).length).toBeGreaterThan(0);
    expect(typeof payload.lawmindReasoningMode).toBe("string");
    expect(typeof payload.lawmindAgentMaxToolCalls).toBe("number");
    expect((payload.lawmindAgentMaxToolCalls as number) >= 1).toBe(true);

    const edition = payload.edition as { label?: string; features?: Record<string, boolean> };
    expect(typeof edition?.label).toBe("string");
    expect(edition?.features?.acceptanceGateStrict).toBe(false);
    const doctor = payload.doctor as { memoryTruthSources?: Record<string, unknown> };
    expect(doctor?.memoryTruthSources).toEqual(
      expect.objectContaining({
        memoryMd: false,
        lawyerProfile: false,
        firmProfile: false,
        clientProfileRoot: false,
        clientProfileFilesUnderClients: 0,
      }),
    );
  });

  it("reports agentMandatoryRulesActive when policy includes mandatory rules", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-mr-"));
    const userEnvPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(userEnvPath, "LAWMIND_AGENT_MODEL=test-model\n", "utf8");
    const policy: LawMindPolicyFile = {
      schemaVersion: 1,
      agentMandatoryRules: "禁止对外承诺结果。",
    };
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: userEnvPath,
      userEnvPath,
      policy: { loaded: true, path: "/x", applied: [], policy },
    };

    const handled = handleHealthRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/health"),
      pathname: "/api/health",
      c: {},
    });

    expect(handled).toBe(true);
    const payload = capture.json();
    expect(payload.agentMandatoryRulesActive).toBe(true);
    expect(payload.agentMandatoryRulesTruncated).toBe(false);
  });
});
