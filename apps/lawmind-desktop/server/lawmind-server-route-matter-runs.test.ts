/**
 * 案件运行等待超时路由：律师的「再等 / 不再等」从这里落到 run 文件。
 *
 * 状态机与落盘细节由 `matter-run-store.test.ts` 覆盖；这里只锁 HTTP 状态码、
 * 参数校验和「不改写没升级的等待」这条边界。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleMatterRunRoutes } from "./lawmind-server-route-matter-runs.js";
import {
  createMatterRunOnDisk,
  escalateDueMatterRunWaits,
  listEscalatedMatterRunWaits,
  loadMatterRun,
  resumeMatterRuns,
} from "../../../src/lawmind/platform/matter-run-store.js";

describe("lawmind-server-route-matter-runs", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-matter-run-route-"));
    dirs.push(dir);
    return dir;
  }

  function response() {
    let status = 0;
    let body = "";
    const res = {
      writeHead(next: number) {
        status = next;
      },
      end(value?: string | Buffer) {
        body += value?.toString() ?? "";
      },
    } as unknown as http.ServerResponse;
    return {
      res,
      get status() {
        return status;
      },
      json: () => JSON.parse(body) as Record<string, unknown>,
    };
  }

  function request(method: string, value?: unknown): http.IncomingMessage {
    const req = { method, headers: {} } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "data" && value !== undefined) {
          cb(Buffer.from(JSON.stringify(value)));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    });
    return req;
  }

  function context(workspaceDir: string): LawmindDispatchContext {
    return {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
  }

  /** 一个已升级的等待步骤：等法院立案，10-28 到期，10-29 升级。 */
  async function escalatedRun(dir: string): Promise<void> {
    createMatterRunOnDisk(dir, {
      matterId: "matter-1",
      runId: "run_wait",
      steps: [{ kind: "wait_court", title: "等法院立案" }],
      at: "2026-10-27T04:00:00.000Z",
    });
    await resumeMatterRuns(dir, {
      executors: {
        wait_court: () => ({
          status: "waiting" as const,
          wait: {
            reason: "court_filing" as const,
            eventKeys: ["matter:matter-1"],
            dueAt: "2026-10-28T00:00:00.000Z",
          },
        }),
      },
      at: "2026-10-27T04:01:00.000Z",
    });
    escalateDueMatterRunWaits(dir, { at: "2026-10-29T00:00:00.000Z" });
  }

  async function post(
    dir: string,
    body: unknown,
    target = { matterId: "matter-1", runId: "run_wait", stepId: "s1" },
    method = "POST",
  ) {
    const out = response();
    const pathname = `/api/matter-runs/${target.matterId}/${target.runId}/steps/${target.stepId}/wait`;
    const handled = await handleMatterRunRoutes({
      ctx: context(dir),
      req: request(method, body),
      res: out.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    expect(handled).toBe(true);
    return out;
  }

  it("extends the wait and clears the escalation", async () => {
    const dir = workspace();
    await escalatedRun(dir);
    expect(listEscalatedMatterRunWaits(dir)).toHaveLength(1);

    const out = await post(dir, { action: "extend" });
    expect(out.status).toBe(200);
    expect(out.json()).toMatchObject({ ok: true, days: 3 });
    expect(loadMatterRun(dir, "matter-1", "run_wait")?.steps[0]?.wait?.escalatedAt).toBeUndefined();
    expect(listEscalatedMatterRunWaits(dir)).toHaveLength(0);
  });

  it("skips the step after the lawyer says they will not wait", async () => {
    const dir = workspace();
    await escalatedRun(dir);

    const out = await post(dir, { action: "skip" });
    expect(out.status).toBe(200);
    expect(loadMatterRun(dir, "matter-1", "run_wait")?.steps[0]?.status).toBe("skipped");
  });

  it("rejects unknown runs, un-escalated waits, and bad bodies", async () => {
    const dir = workspace();
    await escalatedRun(dir);

    const missing = await post(dir, { action: "extend" }, {
      matterId: "matter-1",
      runId: "run_missing",
      stepId: "s1",
    });
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ ok: false, reason: "run_not_found" });

    // 先续等，升级标记被清掉；再点一次就不能当成已升级处理。
    expect((await post(dir, { action: "extend" })).status).toBe(200);
    const notEscalated = await post(dir, { action: "skip" });
    expect(notEscalated.status).toBe(409);
    expect(notEscalated.json()).toMatchObject({ ok: false, reason: "step_not_escalated" });

    const badBody = await post(dir, { action: "cancel" });
    expect(badBody.status).toBe(400);

    const badMethod = await post(dir, { action: "extend" }, undefined, "GET");
    expect(badMethod.status).toBe(405);
  });

  it("stays out of unrelated paths", () => {
    const dir = workspace();
    const out = response();
    const pathname = "/api/matter-runs/matter-1/run_wait/steps";
    const handled = handleMatterRunRoutes({
      ctx: context(dir),
      req: request("POST", { action: "extend" }),
      res: out.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    expect(handled).toBe(false);
  });
});
