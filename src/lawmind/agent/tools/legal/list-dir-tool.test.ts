import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { listDirTool } from "./list-dir-tool.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-list",
    actorId: "lawyer",
    ...extra,
  };
}

describe("list_dir", () => {
  it("returns recursive entries for a workspace folder", async () => {
    const ws = tmp("lm-list-tool-");
    fs.mkdirSync(path.join(ws, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(ws, "a", "one.md"), "1");
    fs.writeFileSync(path.join(ws, "a", "b", "two.txt"), "2");
    const result = await listDirTool.execute({ path: "a" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as {
      kind?: string;
      entries?: Array<{ path: string }>;
      truncated?: boolean;
    };
    expect(data.kind).toBe("directory");
    expect(data.entries?.map((e) => e.path)).toEqual(
      expect.arrayContaining(["a/one.md", "a/b", "a/b/two.txt"]),
    );
    expect(data.truncated).toBe(false);
  });

  it("defaults empty path to the project directory when set", async () => {
    const ws = tmp("lm-list-tool-ws-");
    const project = tmp("lm-list-tool-proj-");
    fs.writeFileSync(path.join(project, "pinned.md"), "p");
    const result = await listDirTool.execute({}, ctx(ws, { projectDir: project }));
    expect(result.ok).toBe(true);
    const data = result.data as { rootKind?: string; entries?: Array<{ path: string }> };
    expect(data.rootKind).toBe("project");
    expect(data.entries?.some((e) => e.path === "pinned.md")).toBe(true);
  });
});
