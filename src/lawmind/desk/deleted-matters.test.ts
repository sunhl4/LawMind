import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMatterIfMissing,
  drainMatterProjections,
} from "../application/services/matter-write-service.js";
import { listMatterIds } from "../cases/index.js";
import { deleteMatterVolume } from "./delete-matter-volume.js";
import { resolveLiveSessionMatterId } from "./deleted-matters.js";

const temps: string[] = [];

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-del-id-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await drainMatterProjections();
  await Promise.all(
    temps
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })),
  );
});

describe("deleted matters stay out of the case list", () => {
  it("hides a deleted id that only remains on an old task, and lets the same id be created again", async () => {
    const ws = await tmp();
    createMatterIfMissing(ws, { matterId: "shell", title: "空壳" });
    createMatterIfMissing(ws, { matterId: "kept", title: "留存" });
    await fs.mkdir(path.join(ws, "tasks"), { recursive: true });
    await fs.writeFile(
      path.join(ws, "tasks", "t-shell.json"),
      JSON.stringify({
        taskId: "t-shell",
        matterId: "shell",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(await listMatterIds(ws)).toEqual(["kept", "shell"]);
    const removed = await deleteMatterVolume(ws, "shell");
    expect(removed.ok).toBe(true);
    expect(await listMatterIds(ws)).toEqual(["kept"]);
    expect(
      JSON.parse(await fs.readFile(path.join(ws, "tasks", "t-shell.json"), "utf8")).matterId,
    ).toBe("shell");

    createMatterIfMissing(ws, { matterId: "shell", title: "空壳再建" });
    expect(await listMatterIds(ws)).toEqual(["kept", "shell"]);
  });

  it("drops a deleted binding and does not adopt that id again", async () => {
    const ws = await tmp();
    createMatterIfMissing(ws, { matterId: "live", title: "在办" });
    createMatterIfMissing(ws, { matterId: "gone", title: "已删" });
    await deleteMatterVolume(ws, "gone");

    expect(resolveLiveSessionMatterId(ws, "gone", undefined)).toBeUndefined();
    expect(resolveLiveSessionMatterId(ws, "gone", "gone")).toBeUndefined();
    expect(resolveLiveSessionMatterId(ws, "gone", "live")).toBe("live");
    expect(resolveLiveSessionMatterId(ws, "live", "gone")).toBe("live");
    expect(resolveLiveSessionMatterId(ws, "task-only", undefined)).toBe("task-only");
  });
});
