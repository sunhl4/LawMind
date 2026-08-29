/**
 * Engine planning — smoke test for planSync.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTaskRecord } from "../tasks/index.js";
import { buildEngineContext } from "./context.js";
import { planSync } from "./planning.js";

describe("engine/planning", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-planning-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    // commitPlannedIntent fire-and-forgets appendTodayLog / matter side effects.
    await new Promise((r) => setTimeout(r, 25));
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("planSync routes a draft instruction and persists a task record", async () => {
    const ctx = buildEngineContext({ workspaceDir, adapters: [] });
    const intent = planSync(ctx, "请起草一份保密协议", { matterId: "matter-plan-1" });
    expect(intent.kind).toBe("draft.word");
    expect(intent.taskId).toBeTruthy();
    expect(intent.matterId).toBe("matter-plan-1");

    const record = readTaskRecord(workspaceDir, intent.taskId);
    expect(record).toBeTruthy();
    expect(record?.status).toBe("created");
  });
});
