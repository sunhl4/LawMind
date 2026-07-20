import type http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleMatterRoutes } from "./lawmind-server-route-matters.js";
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

function createJsonRequest(method: string, body?: unknown): http.IncomingMessage {
  const req = {
    method,
    headers: {},
  } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  });
  return req;
}

let displayNameTestWs: string | null = null;
afterEach(async () => {
  if (displayNameTestWs) {
    await fs.rm(displayNameTestWs, { recursive: true, force: true });
    displayNameTestWs = null;
  }
});

describe("lawmind-server-route-matters", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("validates matter id for search route", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/search?matterId=*&q=test"),
        pathname: "/api/matters/search",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, error: "invalid matter id" });
  });

  it("POST /api/matters/display-name writes 案件名称（展示用）", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-display-name-"));
    displayNameTestWs = ws;
    await fs.mkdir(path.join(ws, "cases", "matter-rename"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "cases", "matter-rename", "CASE.md"),
      "# x\n\n## 1. 基本信息\n\n- matterId: matter-rename\n",
      "utf8",
    );
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    const handled = await handleMatterRoutes({
      ctx,
      req: createJsonRequest("POST", { matterId: "matter-rename", displayName: "新展示名" }),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/matters/display-name"),
      pathname: "/api/matters/display-name",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.json()).toMatchObject({ ok: true, displayName: "新展示名" });
    const raw = await fs.readFile(path.join(ws, "cases", "matter-rename", "CASE.md"), "utf8");
    expect(raw).toContain("案件名称（展示用）: 新展示名");
  });

  it("POST /api/matters/repair-projections rebuilds CASE from JSON", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-repair-"));
    const matterId = "matter-repair";
    await fs.mkdir(path.join(ws, "cases", matterId), { recursive: true });
    await fs.mkdir(path.join(ws, "matters", matterId), { recursive: true });
    await fs.writeFile(
      path.join(ws, "matters", matterId, "matter.json"),
      JSON.stringify({
        matterId,
        title: "JSON 标题",
        status: "active",
        sensitivity: "normal",
        strategyStatus: "missing",
        openQuestionIds: [],
        nextActions: [],
        deadlineIds: [],
        deliverableIds: [],
        queueItemIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    const handled = await handleMatterRoutes({
      ctx,
      req: createJsonRequest("POST", {}),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/matters/repair-projections"),
      pathname: "/api/matters/repair-projections",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.json()).toMatchObject({ ok: true, repaired: 1 });
    const caseRaw = await fs.readFile(path.join(ws, "cases", matterId, "CASE.md"), "utf8");
    expect(caseRaw).toContain("JSON 标题");
    await fs.rm(ws, { recursive: true, force: true });
  });

  it("POST /api/matters/profile updates archive fields and activates on engagement", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-profile-"));
    try {
      const { createMatterIfAbsent } = await import("../../../src/lawmind/cases/matter-create.js");
      await createMatterIfAbsent(ws, "profile-matter", { displayName: "初名", status: "intake" });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", {
          matterId: "profile-matter",
          title: "张三租赁案",
          clientId: "client-zhang",
          causeOfAction: "房屋租赁合同纠纷",
          counterparty: "李四",
          sensitivity: "high",
          conflictCheckConfirmed: true,
          engagementAccepted: true,
        }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/profile"),
        pathname: "/api/matters/profile",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      const body = capture.json();
      expect(body).toMatchObject({
        ok: true,
        profile: {
          matterId: "profile-matter",
          title: "张三租赁案",
          clientId: "client-zhang",
          causeOfAction: "房屋租赁合同纠纷",
          counterparty: "李四",
          sensitivity: "high",
          status: "active",
          needsEnrichment: false,
        },
      });
      const caseRaw = await fs.readFile(path.join(ws, "cases", "profile-matter", "CASE.md"), "utf8");
      expect(caseRaw).toContain("案由: 房屋租赁合同纠纷");
      expect(caseRaw).toContain("对方当事人: 李四");
      expect(caseRaw).toContain("客户 / clientId: client-zhang");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("POST /api/matters/display-name creates CASE.md when only cases/<id>/ exists", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-display-name-empty-"));
    try {
      await fs.mkdir(path.join(ws, "cases", "matter-empty"), { recursive: true });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", { matterId: "matter-empty", displayName: "房屋租赁" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/display-name"),
        pathname: "/api/matters/display-name",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, displayName: "房屋租赁" });
      const raw = await fs.readFile(path.join(ws, "cases", "matter-empty", "CASE.md"), "utf8");
      expect(raw).toContain("案件名称（展示用）: 房屋租赁");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("POST /api/matters/delete removes cases/<matterId>", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-delete-"));
    try {
      await fs.mkdir(path.join(ws, "cases", "matter-del"), { recursive: true });
      await fs.writeFile(
        path.join(ws, "cases", "matter-del", "CASE.md"),
        "# x\n",
        "utf8",
      );
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", { matterId: "matter-del" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/delete"),
        pathname: "/api/matters/delete",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, matterId: "matter-del", deletedFromDisk: true });
      await expect(fs.access(path.join(ws, "cases", "matter-del"))).rejects.toBeDefined();
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("POST /api/matters/delete succeeds when cases/<matterId> is already absent (phantom row)", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-delete-missing-"));
    try {
      await fs.mkdir(path.join(ws, "cases"), { recursive: true });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", { matterId: "YX-jqjnjb" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/delete"),
        pathname: "/api/matters/delete",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({
        ok: true,
        matterId: "YX-jqjnjb",
        deletedFromDisk: false,
      });
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("GET /api/matters/role returns folder when no CASE.md", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-role-get-"));
    try {
      await fs.mkdir(path.join(ws, "cases", "role-get"), { recursive: true });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/role?matterId=role-get"),
        pathname: "/api/matters/role",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, matterId: "role-get", role: "folder" });
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("POST /api/matters/role folder writes .lawmind-role.txt", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-role-post-"));
    try {
      await fs.mkdir(path.join(ws, "cases", "role-post"), { recursive: true });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", { matterId: "role-post", role: "folder" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/role"),
        pathname: "/api/matters/role",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, matterId: "role-post", role: "folder" });
      const raw = await fs.readFile(path.join(ws, "cases", "role-post", ".lawmind-role.txt"), "utf8");
      expect(raw.trim().toLowerCase()).toBe("folder");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("POST /api/matters/role matter creates CASE.md", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-matter-role-matter-"));
    try {
      await fs.mkdir(path.join(ws, "cases", "role-matter"), { recursive: true });
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      const handled = await handleMatterRoutes({
        ctx,
        req: createJsonRequest("POST", { matterId: "role-matter", role: "matter" }),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/matters/role"),
        pathname: "/api/matters/role",
        c: {},
      });
      expect(handled).toBe(true);
      expect(capture.status).toBe(200);
      expect(capture.json()).toMatchObject({ ok: true, matterId: "role-matter", role: "matter" });
      await fs.access(path.join(ws, "cases", "role-matter", "CASE.md"));
      const roleRaw = await fs.readFile(
        path.join(ws, "cases", "role-matter", ".lawmind-role.txt"),
        "utf8",
      );
      expect(roleRaw.trim().toLowerCase()).toBe("matter");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("GET /api/matters/team-meeting rejects invalid matter id", async () => {
    const ctx: LawmindRouteContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await handleMatterRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/matters/team-meeting?matterId=../x"),
      pathname: "/api/matters/team-meeting",
      c: {},
    });
    expect(capture.status).toBe(400);
  });

  it("GET /api/matters/team-meeting returns lines tail", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-team-meeting-get-"));
    try {
      const matterId = "tm-get";
      await fs.mkdir(path.join(ws, "cases", matterId), { recursive: true });
      const fp = path.join(ws, "cases", matterId, "team-meeting.jsonl");
      await fs.writeFile(
        fp,
        `${JSON.stringify({ id: "a", ts: "2026-01-01T00:00:00.000Z", kind: "user", text: "hi" })}\n`,
        "utf8",
      );
      const ctx: LawmindRouteContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      await handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL(`http://127.0.0.1/api/matters/team-meeting?matterId=${matterId}`),
        pathname: "/api/matters/team-meeting",
        c: {},
      });
      expect(capture.status).toBe(200);
      const j = capture.json();
      expect(j.ok).toBe(true);
      expect(Array.isArray(j.lines)).toBe(true);
      expect(j.lines).toHaveLength(1);
      expect(j.total).toBe(1);
      expect(j.lines[0]).toMatchObject({ kind: "user", text: "hi" });
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("GET /api/matters/team-meeting supports skipFromEnd window", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-team-meeting-skip-"));
    try {
      const matterId = "tm-skip";
      await fs.mkdir(path.join(ws, "cases", matterId), { recursive: true });
      const fp = path.join(ws, "cases", matterId, "team-meeting.jsonl");
      const rows = ["a", "b", "c"].map((t) =>
        JSON.stringify({ id: t, ts: "2026-01-01T00:00:00.000Z", kind: "user", text: t }),
      );
      await fs.writeFile(fp, `${rows.join("\n")}\n`, "utf8");
      const ctx: LawmindRouteContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      await handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL(
          `http://127.0.0.1/api/matters/team-meeting?matterId=${matterId}&limit=2&skipFromEnd=1`,
        ),
        pathname: "/api/matters/team-meeting",
        c: {},
      });
      expect(capture.status).toBe(200);
      const j = capture.json();
      expect(j.ok).toBe(true);
      expect(j.total).toBe(3);
      expect(j.lines.map((x: { text: string }) => x.text)).toEqual(["a", "b"]);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("GET /api/matters/review-matrix returns documents and cells", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-review-matrix-"));
    try {
      const matterId = "rm-1";
      const taskId = "task-rm";
      await fs.mkdir(path.join(ws, "drafts"), { recursive: true });
      await fs.mkdir(path.join(ws, "tasks"), { recursive: true });
      await fs.writeFile(
        path.join(ws, "drafts", `${taskId}.json`),
        JSON.stringify({
          taskId,
          matterId,
          title: "合同",
          sections: [{ heading: "违约", body: "违约赔偿条款。" }],
          reviewStatus: "pending",
        }),
        "utf8",
      );
      await fs.writeFile(
        path.join(ws, "tasks", `${taskId}.json`),
        JSON.stringify({
          taskId,
          matterId,
          kind: "agent.instruction",
          status: "running",
          summary: "合同",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        }),
        "utf8",
      );
      const ctx: LawmindDispatchContext = {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      };
      const capture = createResponseCapture();
      await handleMatterRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL(`http://127.0.0.1/api/matters/review-matrix?matterId=${matterId}`),
        pathname: "/api/matters/review-matrix",
        c: {},
      });
      expect(capture.status).toBe(200);
      const j = capture.json();
      expect(j.ok).toBe(true);
      const matrix = j.matrix as { documents: unknown[]; cells: unknown[] };
      expect(matrix.documents.length).toBeGreaterThan(0);
      expect(matrix.cells.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});
