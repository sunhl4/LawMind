import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import {
  checkConflictOfInterest,
  readProjectFile,
  searchCaseLaw,
  searchMatter,
  searchStatute,
  searchWorkspace,
} from "./search-tools.js";

function makeCtx(workspaceDir: string, extra: Partial<AgentContext> = {}): AgentContext {
  return {
    workspaceDir,
    sessionId: "test-session",
    actorId: "test-lawyer",
    ...extra,
  };
}

describe("search_matter", () => {
  it("requires matter when matter_id missing", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-search-no-matter-"));
    try {
      const result = await searchMatter.execute({ query: "押金" }, makeCtx(workspaceDir));
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/案件/);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns hits from matter index", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-search-matter-"));
    const matterId = "matter-search";
    try {
      await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "cases", matterId, "CASE.md"),
        "# 租赁合同纠纷\n\n## 4. 核心争点\n\n- 押金退还\n",
        "utf8",
      );
      const result = await searchMatter.execute({ query: "押金" }, makeCtx(workspaceDir, { matterId }));
      expect(result.ok).toBe(true);
      const data = result.data as { hits: unknown[]; matterId: string };
      expect(data.matterId).toBe(matterId);
      expect(data.hits.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

describe("read_project_file", () => {
  it("fails without projectDir", async () => {
    const result = await readProjectFile.execute({ relative_path: "a.txt" }, makeCtx("/tmp"));
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/项目目录/);
  });

  it("reads text file with pagination", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-read-"));
    try {
      await fs.writeFile(path.join(root, "memo.txt"), "租赁押金争议说明", "utf8");
      const result = await readProjectFile.execute(
        { relative_path: "memo.txt", offset: 0, limit: 4 },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(true);
      const data = result.data as { content: string; hasMore: boolean; totalChars: number };
      expect(data.content).toContain("租赁押金");
      expect(data.hasMore).toBe(true);
      expect(data.totalChars).toBeGreaterThan(4);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects path traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-escape-"));
    try {
      const result = await readProjectFile.execute(
        { relative_path: "../secret.txt" },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/非法路径|越界/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsupported legacy office formats", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-doc-"));
    try {
      await fs.writeFile(path.join(root, "legacy.doc"), "binary", "utf8");
      const result = await readProjectFile.execute(
        { relative_path: "legacy.doc" },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/\.doc/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns not found for missing file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-miss-"));
    try {
      const result = await readProjectFile.execute(
        { relative_path: "missing.txt" },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/不存在/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects empty relative path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-empty-rel-"));
    try {
      const result = await readProjectFile.execute(
        { relative_path: "  " },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/非法路径|不存在/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects binary files for plain text read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-bin-"));
    try {
      await fs.writeFile(path.join(root, "data.bin"), Buffer.from([0, 1, 2, 0, 4]));
      const result = await readProjectFile.execute(
        { relative_path: "data.bin" },
        makeCtx("/tmp", { projectDir: root }),
      );
      expect(result.ok).toBe(false);
      expect(String(result.error)).toMatch(/二进制/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

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

  it("returns statute hits from matter CASE", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-statute-hit-"));
    const matterId = "statute-m";
    try {
      await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "cases", matterId, "CASE.md"),
        "# 案件\n\n《民法典》第七百零一条 租赁期限\n",
        "utf8",
      );
      const result = await searchStatute.execute(
        { query: "民法典", matter_id: matterId },
        makeCtx(workspaceDir, { matterId }),
      );
      expect(result.ok).toBe(true);
      const data = result.data as { hits: Array<{ snippet: string }>; refusalRequired?: boolean };
      expect(data.hits.length).toBeGreaterThan(0);
      expect(data.refusalRequired).toBeUndefined();
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns case-law hits from matter drafts", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-case-hit-"));
    const matterId = "case-m";
    try {
      await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, "drafts"), { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "cases", matterId, "CASE.md"),
        "# 案件\n\n参考 (2024)京01民终123号 判决书\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "drafts", "draft-1.json"),
        JSON.stringify({
          taskId: "draft-1",
          matterId,
          title: "类案检索",
          summary: "",
          sections: [{ heading: "参考", body: "最高人民法院相关裁定书" }],
          reviewNotes: [],
          reviewStatus: "pending",
          output: "docx",
          templateId: "general",
          createdAt: new Date().toISOString(),
        }),
        "utf8",
      );
      const result = await searchCaseLaw.execute(
        { query: "裁定书", matter_id: matterId },
        makeCtx(workspaceDir, { matterId }),
      );
      expect(result.ok).toBe(true);
      const data = result.data as { hits: unknown[] };
      expect(data.hits.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});

describe("check_conflict_of_interest", () => {
  it("flags party appearing in multiple matters", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-conflict-"));
    try {
      for (const mid of ["m-a", "m-b"]) {
        await fs.mkdir(path.join(workspaceDir, "cases", mid), { recursive: true });
        await fs.writeFile(
          path.join(workspaceDir, "cases", mid, "CASE.md"),
          `# ${mid}\n\n对方当事人: 张三公司\n`,
          "utf8",
        );
      }
      const result = await checkConflictOfInterest.execute(
        { parties: "张三公司" },
        makeCtx(workspaceDir),
      );
      expect(result.ok).toBe(true);
      const data = result.data as { conflictFlags: string[]; matches: Record<string, string[]> };
      expect(data.conflictFlags.length).toBeGreaterThan(0);
      expect(data.matches["张三公司"]?.length).toBeGreaterThan(1);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects empty party names", async () => {
    const result = await checkConflictOfInterest.execute({ parties: "  , " }, makeCtx("/tmp"));
    expect(result.ok).toBe(false);
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

  it("scans project directory when projectDir set", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-ws-proj-"));
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-proj-ws-"));
    try {
      await fs.writeFile(path.join(projectDir, "notes.md"), "项目关键字-BETA\n", "utf8");
      const result = await searchWorkspace.execute(
        { query: "关键字-beta" },
        { ...makeCtx(workspaceDir), projectDir },
      );
      expect(result.ok).toBe(true);
      const data = result.data as {
        results: Array<{ source: string }>;
        projectScanned: boolean;
      };
      expect(data.projectScanned).toBe(true);
      expect(data.results.some((r) => r.source.startsWith("project:"))).toBe(true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("scans other matters when cross-matter env enabled", async () => {
    process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH = "1";
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-cross-"));
    try {
      await fs.mkdir(path.join(workspaceDir, "cases", "matter-b"), { recursive: true });
      await fs.writeFile(
        path.join(workspaceDir, "cases", "matter-b", "CASE.md"),
        "# 其他\n\n共享关键字-GAMMA\n",
        "utf8",
      );
      const result = await searchWorkspace.execute(
        { query: "关键字-gamma" },
        { ...makeCtx(workspaceDir), matterId: "matter-a" },
      );
      expect(result.ok).toBe(true);
      const data = result.data as {
        results: Array<{ source: string }>;
        crossMatterScanned: boolean;
      };
      expect(data.crossMatterScanned).toBe(true);
      expect(data.results.some((r) => r.source === "CASE:matter-b")).toBe(true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
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
