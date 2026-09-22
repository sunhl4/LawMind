import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import { MOUNT_WRITE_REFUSAL } from "../../../src/lawmind/host-access/access-broker.js";
import { PROTECTED_WORKSPACE_WRITE_REFUSAL } from "../../../src/lawmind/runtime/protected-workspace-rels.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  const res = {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string | Buffer) {
      if (typeof payload === "string") {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
  return res;
}

describe("lawmind-server-route-fs", () => {
  let workspaceDir: string;
  let hostAccessFile: string;
  let mountDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-fs-route-"));
    await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "artifacts", "demo.txt"), "hello", "utf8");
    mountDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-fs-mount-"));
    hostAccessFile = path.join(workspaceDir, "host-access.json");
    await fs.writeFile(
      hostAccessFile,
      JSON.stringify({ schemaVersion: 1, mounts: [{ id: "m1", absPath: mountDir }] }),
      "utf8",
    );
    process.env.LAWMIND_HOST_ACCESS_FILE = hostAccessFile;
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    delete process.env.LAWMIND_HOST_ACCESS_FILE;
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(mountDir, { recursive: true, force: true });
  });

  it("returns 404 for missing artifact", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req,
      res,
      url: new URL("http://127.0.0.1/api/artifact?path=missing.txt"),
      pathname: "/api/artifact",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(404);
  });

  function mockJsonRequest(method: string, body: Record<string, unknown>): http.IncomingMessage {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const req = {
      method,
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(cb);
        listeners.set(event, list);
        return req;
      },
      destroy() {},
    } as unknown as http.IncomingMessage;
    queueMicrotask(() => {
      const payload = JSON.stringify(body);
      for (const cb of listeners.get("data") ?? []) {
        cb(Buffer.from(payload, "utf8"));
      }
      for (const cb of listeners.get("end") ?? []) {
        cb();
      }
    });
    return req;
  }

  async function postFsWrite(body: Record<string, unknown>) {
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req: mockJsonRequest("POST", body),
      res,
      url: new URL("http://127.0.0.1/api/fs/write"),
      pathname: "/api/fs/write",
      c: {},
    });
    return { handled, res };
  }

  it("refuses writes into a host mount (mount:<id> is read-only)", async () => {
    const { handled, res } = await postFsWrite({
      root: "mount:m1",
      path: "evil.txt",
      content: "should not land",
    });

    expect(handled).toBe(true);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      ok: false,
      code: "root_not_writable",
      error: MOUNT_WRITE_REFUSAL,
    });
    await expect(fs.readFile(path.join(mountDir, "evil.txt"), "utf8")).rejects.toThrow();
  });

  it("refuses any root outside the writable allowlist", async () => {
    const { res } = await postFsWrite({ root: "grant:g1", path: "x.txt", content: "no" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ ok: false, code: "root_not_writable" });
  });

  it("still allows writes inside the workspace", async () => {
    const { res } = await postFsWrite({
      root: "workspace",
      path: "notes/keep.md",
      content: "ok",
    });

    expect(res.status).toBe(200);
    await expect(fs.readFile(path.join(workspaceDir, "notes", "keep.md"), "utf8")).resolves.toBe(
      "ok",
    );
  });

  it("still refuses protected governance paths inside the workspace", async () => {
    const { res } = await postFsWrite({
      root: "workspace",
      path: "lawmind.policy.json",
      content: "{}",
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      ok: false,
      code: "protected_workspace_path",
      error: PROTECTED_WORKSPACE_WRITE_REFUSAL,
    });
  });
});
