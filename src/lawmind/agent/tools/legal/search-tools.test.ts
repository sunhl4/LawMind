import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { searchCaseLaw, searchStatute, searchWorkspace } from "./search-tools.js";

function makeCtx(workspaceDir: string): AgentContext {
  return {
    workspaceDir,
    sessionId: "test-session",
    actorId: "test-lawyer",
  };
}

describe("search_statute / search_case_law", () => {
  it("fails on empty query", async () => {
    const ctx = makeCtx("/tmp/lawmind-search-empty");
    const statute = await searchStatute.execute({ query: "  " }, ctx);
    expect(statute.ok).toBe(false);
    expect(statute.error).toMatch(/query/);

    const caseLaw = await searchCaseLaw.execute({ query: "" }, ctx);
    expect(caseLaw.ok).toBe(false);
    expect(caseLaw.error).toMatch(/query/);
  });

  it("empty hits return ok with refusalRequired", async () => {
    const ctx = makeCtx("/tmp/lawmind-search-nohits-" + Date.now());
    const statute = await searchStatute.execute({ query: "zzzz-nonexistent-statute-xyz-999" }, ctx);
    expect(statute.ok).toBe(true);
    const sData = statute.data as {
      hits: unknown[];
      refusalRequired?: boolean;
      authority?: string;
    };
    expect(sData.hits).toEqual([]);
    expect(sData.refusalRequired).toBe(true);
    expect(sData.authority).toBe("none");

    const caseLaw = await searchCaseLaw.execute({ query: "zzzz-nonexistent-case-xyz-999" }, ctx);
    expect(caseLaw.ok).toBe(true);
    const cData = caseLaw.data as {
      hits: unknown[];
      refusalRequired?: boolean;
      authority?: string;
    };
    expect(cData.hits).toEqual([]);
    expect(cData.refusalRequired).toBe(true);
    expect(cData.authority).toBe("none");
  });
});

describe("search_workspace matter isolation", () => {
  const previous = process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    } else {
      process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH = previous;
    }
  });

  it("does not search other matters unless explicitly enabled", async () => {
    delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-isolation-"));
    try {
      await fs.mkdir(path.join(workspaceDir, "cases", "matter-other"), { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "cases", "matter-other", "CASE.md"),
        "# 其他案件\n仅此案可见关键字-ALPHA",
      );
      const result = await searchWorkspace.execute(
        { query: "关键字-alpha" },
        { ...makeCtx(workspaceDir), matterId: "matter-current" },
      );
      expect(result.ok).toBe(true);
      const data = result.data as {
        results: Array<{ source: string; snippet: string }>;
        crossMatterScanned: boolean;
      };
      expect(data.crossMatterScanned).toBe(false);
      expect(data.results.some((row) => row.source === "CASE:matter-other")).toBe(false);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
