import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("returns false for non-health routes", async () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    const handled = await handleHealthRoute({
      ctx,
      req: { method: "POST" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/other"),
      pathname: "/api/other",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("returns health payload for GET /api/health", async () => {
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-route-"));
    const userEnvPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(
      userEnvPath,
      "LAWMIND_AGENT_API_KEY=test-key\nLAWMIND_AGENT_MODEL=test-model\n",
      "utf8",
    );
    process.env.LAWMIND_AGENT_API_KEY = "test-key";
    process.env.LAWMIND_AGENT_MODEL = "test-model";
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: userEnvPath,
      userEnvPath,
      policy: { loaded: false },
    };

    try {
      const handled = await handleHealthRoute({
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
      expect(edition?.features?.acceptanceGateStrict).toBe(true);
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
      expect(doctor?.matterConsistency).toMatchObject({ ok: true, issueCount: 0 });
      expect(doctor?.authorityCorpus).toMatchObject({
        configured: true,
        status: "sample-ready",
        provider: "open",
        envKey: "LAWMIND_AUTHORITY_ENDPOINT",
      });
      expect(doctor?.rateLimit).toBeNull();
      expect(doctor?.skipApiAuthWarn).toBe(false);
    } finally {
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
    }
  });

  it("reports agentMandatoryRulesActive when policy includes mandatory rules", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-mr-"));
    const userEnvPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(
      userEnvPath,
      "LAWMIND_AGENT_API_KEY=test-key\nLAWMIND_AGENT_MODEL=test-model\n",
      "utf8",
    );
    process.env.LAWMIND_AGENT_API_KEY = "test-key";
    process.env.LAWMIND_AGENT_MODEL = "test-model";
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

    const handled = await handleHealthRoute({
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

  it("POST /api/authority/probe succeeds for default open local corpus", async () => {
    const prevEndpoint = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    delete process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    try {
      const handled = await handleHealthRoute({
        ctx,
        req: { method: "POST" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/authority/probe"),
        pathname: "/api/authority/probe",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      const body = capture.json() as {
        ok?: boolean;
        note?: string;
        probe?: { ok?: boolean; hitCount?: number };
        authorityCorpus?: { provider?: string; status?: string };
      };
      expect(body).toMatchObject({
        ok: true,
        authorityCorpus: { provider: "open", status: "sample-ready" },
      });
      expect(typeof body.probe?.hitCount).toBe("number");
      expect((body.probe?.hitCount ?? 0) > 0).toBe(true);
      expect(body.note).toMatch(/开源语料/);
    } finally {
      if (prevEndpoint === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEndpoint;
      }
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
    }
  });

  it("POST /api/authority/probe does not go green for lexis placeholder", async () => {
    const prevEndpoint = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://lexis.example/search";
    process.env.LAWMIND_AUTHORITY_PROVIDER = "lexis";
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    try {
      const handled = await handleHealthRoute({
        ctx,
        req: { method: "POST" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/authority/probe"),
        pathname: "/api/authority/probe",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(501);
      const body = capture.json() as {
        ok?: boolean;
        probe?: { ok?: boolean; error?: string };
        note?: string;
        authorityCorpus?: { status?: string };
      };
      expect(body.ok).toBe(false);
      expect(body.probe?.ok).toBe(false);
      expect(body.authorityCorpus?.status).toBe("unimplemented");
      expect(body.probe?.error ?? body.note ?? "").toMatch(/Lexis|尚未实现|占位/i);
    } finally {
      if (prevEndpoint === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEndpoint;
      }
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
    }
  });

  it("POST /api/authority/probe fails closed when generic endpoint unset", async () => {
    const prevEndpoint = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
    process.env.LAWMIND_AUTHORITY_PROVIDER = "generic";
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    try {
      const handled = await handleHealthRoute({
        ctx,
        req: { method: "POST" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/authority/probe"),
        pathname: "/api/authority/probe",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(400);
      expect(capture.json()).toMatchObject({
        ok: false,
        code: "authority_endpoint_unset",
      });
    } finally {
      if (prevEndpoint === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEndpoint;
      }
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
    }
  });

  it("POST /api/authority/probe rejects invalid endpoint without fetch", async () => {
    const prevEndpoint = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "ftp://evil.example/x";
    process.env.LAWMIND_AUTHORITY_PROVIDER = "generic";
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    try {
      const handled = await handleHealthRoute({
        ctx,
        req: { method: "POST" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/authority/probe"),
        pathname: "/api/authority/probe",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(400);
      expect(capture.json()).toMatchObject({
        ok: false,
        code: "authority_endpoint_invalid",
      });
    } finally {
      if (prevEndpoint === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEndpoint;
      }
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
    }
  });

  it("POST /api/authority/probe succeeds when generic endpoint healthy", async () => {
    const prevEndpoint = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://authority.example/search";
    process.env.LAWMIND_AUTHORITY_PROVIDER = "generic";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ hits: [{ id: "1", title: "t" }] })),
    );
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    try {
      const handled = await handleHealthRoute({
        ctx,
        req: { method: "POST" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/authority/probe"),
        pathname: "/api/authority/probe",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, probe: { ok: true } });
    } finally {
      vi.unstubAllGlobals();
      if (prevEndpoint === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEndpoint;
      }
      if (prevProvider === undefined) {
        delete process.env.LAWMIND_AUTHORITY_PROVIDER;
      } else {
        process.env.LAWMIND_AUTHORITY_PROVIDER = prevProvider;
      }
    }
  });
});
