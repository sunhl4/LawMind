import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRedlineHunksWithOfficeCli,
  renderDocxWithTrackedChanges,
  resolveOfficeCliFindReplace,
} from "./render-docx-tracked.js";
import { renderDocxWithOptions } from "./render-docx.js";

vi.mock("./render-docx.js", () => ({
  renderDocxWithOptions: vi.fn(async () => ({ ok: true, outputPath: "/tmp/out.docx" })),
}));

const spawnState = vi.hoisted(() => ({
  /** When true, `set` exits 0 with matched>0; otherwise exit 1. */
  setSucceeds: false,
  /** Optional override for matched count in JSON stdout. */
  matched: 1 as number,
  /** Per-`set` matched overrides (shifted in call order); falls back to `matched`. */
  matchedQueue: [] as number[],
  lastSetArgs: [] as string[],
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn((_cmd: string, args: string[]) => {
    const isSet = args[0] === "set";
    const isClose = args[0] === "close";
    if (isSet) {
      spawnState.lastSetArgs = [...args];
    }
    const matched =
      isSet && spawnState.matchedQueue.length > 0
        ? (spawnState.matchedQueue.shift() ?? 1)
        : spawnState.matched;
    const code = isClose ? 0 : isSet && spawnState.setSucceeds ? 0 : 1;
    const stdout =
      isSet && spawnState.setSucceeds ? JSON.stringify({ success: true, matched, data: "ok" }) : "";
    let stdoutHandler: ((arg?: unknown) => void) | undefined;
    let closeHandler: ((arg?: unknown) => void) | undefined;
    // stdout 只发一次：注册 data 与 close 时都会 flush，重复发送会让 JSON.parse 失败。
    let stdoutSent = false;
    const flush = () => {
      if (stdout && stdoutHandler && !stdoutSent) {
        stdoutSent = true;
        stdoutHandler(stdout);
      }
      if (closeHandler) {
        queueMicrotask(() => closeHandler?.(code));
      }
    };
    return {
      stdout: {
        on: (ev: string, fn: (arg?: unknown) => void) => {
          if (ev === "data") {
            stdoutHandler = fn;
            flush();
          }
        },
      },
      stderr: { on: () => undefined },
      on: (ev: string, fn: (arg?: unknown) => void) => {
        if (ev === "close") {
          closeHandler = fn;
          flush();
        }
      },
      kill: vi.fn(),
    };
  }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  spawnState.setSucceeds = false;
  spawnState.matched = 1;
  spawnState.matchedQueue = [];
  spawnState.lastSetArgs = [];
});

describe("renderDocxWithTrackedChanges", () => {
  it("falls back to plain docx when officecli set fails", async () => {
    spawnState.setSucceeds = false;
    const result = await renderDocxWithTrackedChanges({
      draft: {
        taskId: "task-1",
        title: "Test",
        summary: "",
        templateId: "general",
        output: "docx",
        reviewStatus: "approved",
        reviewNotes: [],
        sections: [{ heading: "一", body: "甲", citations: [] }],
        createdAt: new Date().toISOString(),
      } as import("../types.js").ArtifactDraft,
      outputDir: "/tmp",
      proposals: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "甲",
          after: "乙",
          status: "pending",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("plain_fallback");
      expect(result.degraded).toBe(true);
      expect(result.baselineSource).toBe("rendered_draft");
    }
  });

  it("returns baseline_missing when contractEdit path is set but file absent", async () => {
    const result = await renderDocxWithTrackedChanges({
      draft: {
        taskId: "task-2",
        title: "Test",
        summary: "",
        templateId: "general",
        output: "docx",
        reviewStatus: "approved",
        reviewNotes: [],
        sections: [],
        createdAt: new Date().toISOString(),
        contractEdit: {
          baselineRelativePath: "missing/contract.docx",
          mode: "surgical",
        },
      } as import("../types.js").ArtifactDraft,
      outputDir: "/tmp",
      proposals: [],
      workspaceDir: "/tmp/ws-not-exist-xyz",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("baseline_missing");
    }
  });

  it("forwards includeProvenance to the plain fallback render", async () => {
    spawnState.setSucceeds = false;
    const draft = {
      taskId: "task-3",
      title: "Test",
      summary: "",
      templateId: "general",
      output: "docx",
      reviewStatus: "approved",
      reviewNotes: [],
      sections: [{ heading: "一", body: "甲", citations: [] }],
      createdAt: new Date().toISOString(),
    } as import("../types.js").ArtifactDraft;
    const result = await renderDocxWithTrackedChanges({
      draft,
      outputDir: "/tmp",
      proposals: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "甲",
          after: "乙",
          status: "pending",
        },
      ],
      includeProvenance: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("plain_fallback");
    }
    expect(renderDocxWithOptions).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-3" }),
      "/tmp",
      expect.objectContaining({ includeProvenance: true }),
    );
  });
});

describe("resolveOfficeCliFindReplace", () => {
  it("uses regex lookbehind so pure inserts only match the trailing anchor", () => {
    const fr = resolveOfficeCliFindReplace(
      {
        hunkId: "h1",
        sectionIndex: 0,
        before: "",
        after: "（上海）",
        status: "accepted",
        granularity: "surgical",
      },
      "甲方：小华半导体（上海）有限公司",
    );
    expect(fr?.regex).toBe(true);
    expect(fr?.find).toBe("(?<=甲方：小华半导体)有");
    expect(fr?.replace).toBe("（上海）有");
  });

  it("minimizes end-of-sentence cap inserts to period anchor", () => {
    const fr = resolveOfficeCliFindReplace(
      {
        hunkId: "h2",
        sectionIndex: 0,
        before: "实际损失。",
        after: "实际损失，但累计赔偿总额不超过该项目已付软件费用。",
        status: "pending",
        granularity: "surgical",
      },
      "并赔偿甲方因此而造成的实际损失，但累计赔偿总额不超过该项目已付软件费用。本条款永久有效",
    );
    expect(fr?.regex).toBe(true);
    expect(fr?.find).toMatch(/\(\?<=.+\)。$/);
    expect(fr?.replace).toBe("，但累计赔偿总额不超过该项目已付软件费用。");
  });
});

describe("applyRedlineHunksWithOfficeCli", () => {
  it("skips rejected and no-op hunks", async () => {
    spawnState.setSucceeds = true;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/x.docx",
      proposals: [
        {
          hunkId: "a",
          sectionIndex: 0,
          before: "x",
          after: "y",
          status: "rejected",
        },
        {
          hunkId: "b",
          sectionIndex: 0,
          before: "same",
          after: "same",
          status: "pending",
        },
      ],
    });
    expect(r.attempted).toBe(0);
    expect(r.applied).toBe(0);
  });

  it("counts successful set find/replace", async () => {
    spawnState.setSucceeds = true;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/x.docx",
      proposals: [
        {
          hunkId: "a",
          sectionIndex: 0,
          before: "x",
          after: "y",
          status: "accepted",
        },
      ],
    });
    expect(r.attempted).toBe(1);
    expect(r.applied).toBe(1);
    expect(r.ambiguous).toBe(0);
  });

  it('uses r"..." find form for regex lookbehind (no regex=true prop)', async () => {
    spawnState.setSucceeds = true;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/x.docx",
      proposals: [
        {
          hunkId: "a",
          sectionIndex: 0,
          before: "实际损失。",
          after: "实际损失，但累计上限。",
          status: "pending",
          granularity: "surgical",
        },
      ],
      sectionBodiesAfter: ["并赔偿实际损失，但累计上限。其余"],
      sectionBodiesBefore: ["并赔偿实际损失。其余"],
    });
    expect(r.applied).toBe(1);
    const findIdx = spawnState.lastSetArgs.indexOf("--find");
    expect(findIdx).toBeGreaterThanOrEqual(0);
    expect(spawnState.lastSetArgs[findIdx + 1]).toMatch(/^r"/);
    expect(spawnState.lastSetArgs).not.toContain("regex=true");
  });

  it("skips ambiguous literal finds that appear more than once in baseline", async () => {
    spawnState.setSucceeds = true;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/x.docx",
      proposals: [
        {
          hunkId: "a",
          sectionIndex: 0,
          before: "五个月",
          after: "三个月",
          status: "pending",
        },
      ],
      sectionBodiesBefore: ["试用期为五个月。", "试用期为五个月。"],
    });
    expect(r.attempted).toBe(1);
    expect(r.applied).toBe(0);
    expect(r.ambiguous).toBe(1);
    expect(r.lastError).toMatch(/ambiguous_match/);
    expect(spawnState.lastSetArgs).toEqual([]);
  });

  it("pins a repeated phrase with section lookbehind instead of skipping", async () => {
    spawnState.setSucceeds = true;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/x.docx",
      proposals: [
        {
          hunkId: "a",
          sectionIndex: 0,
          before: "二十四（24",
          after: "十二（12",
          status: "pending",
          spanStart: 3,
        },
      ],
      sectionBodiesBefore: ["终止后二十四（24）个月内", "有效期二十四（24）个月"],
    });
    expect(r.applied).toBe(1);
    expect(r.ambiguous).toBe(0);
    const findIdx = spawnState.lastSetArgs.indexOf("--find");
    expect(spawnState.lastSetArgs[findIdx + 1]).toMatch(/^r"/);
    expect(spawnState.lastSetArgs[findIdx + 1]).toContain("二十四");
  });

  it("rolls back and skips a hunk when officecli reports matched > 1", async () => {
    spawnState.setSucceeds = true;
    spawnState.matched = 2;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-apply-multi-"));
    const working = path.join(dir, "w.docx");
    fs.writeFileSync(working, "original");
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: working,
      proposals: [
        {
          hunkId: "m1",
          sectionIndex: 0,
          before: "甲",
          after: "乙",
          status: "pending",
        },
      ],
    });
    // 多处命中：该 hunk 不得落盘——不计 applied，记入 ambiguous 并回滚工作副本。
    expect(r.applied).toBe(0);
    expect(r.ambiguous).toBe(1);
    expect(r.ambiguousHunkIds).toContain("m1");
    expect(r.rollbackFailed).toBeUndefined();
    expect(r.lastError).toMatch(/multi_match_skipped/);
    expect(fs.readFileSync(working, "utf8")).toBe("original");
    expect(fs.existsSync(`${working}.lm-bak`)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("flags rollbackFailed when matched > 1 and no backup could be taken", async () => {
    spawnState.setSucceeds = true;
    spawnState.matched = 3;
    const r = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: "/tmp/lm-no-such-working-copy.docx",
      proposals: [
        {
          hunkId: "m2",
          sectionIndex: 0,
          before: "甲",
          after: "乙",
          status: "pending",
        },
      ],
    });
    expect(r.applied).toBe(0);
    expect(r.ambiguous).toBe(1);
    expect(r.ambiguousHunkIds).toContain("m2");
    expect(r.rollbackFailed).toBe(true);
    expect(r.lastError).toMatch(/multi_match_rollback_failed/);
  });
});

describe("renderDocxWithTrackedChanges multi-match safety", () => {
  it("delivers partial explicitly: multi-match hunk skipped, manifest and warning say so", async () => {
    spawnState.setSucceeds = true;
    // 第一个 hunk 正常命中 1 处；第二个在 docx 实际内容中命中 2 处（如页眉重复）。
    spawnState.matchedQueue = [1, 2];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tracked-multi-"));
    fs.writeFileSync(path.join(dir, "合同.docx"), "pk");
    const result = await renderDocxWithTrackedChanges({
      draft: {
        taskId: "task-multi",
        title: "Test",
        summary: "",
        templateId: "general",
        output: "docx",
        reviewStatus: "approved",
        reviewNotes: [],
        sections: [{ heading: "一", body: "甲和丙", citations: [] }],
        createdAt: new Date().toISOString(),
        contractEdit: {
          baselineRelativePath: "合同.docx",
          mode: "surgical",
        },
      } as import("../types.js").ArtifactDraft,
      outputDir: dir,
      proposals: [
        { hunkId: "ok-1", sectionIndex: 0, before: "甲", after: "乙", status: "pending" },
        { hunkId: "amb-1", sectionIndex: 0, before: "丙", after: "丁", status: "pending" },
      ],
      workspaceDir: dir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("officecli");
      expect(result.appliedHunks).toBe(1);
      expect(result.degraded).toBe(true);
      expect(result.warning).toContain("未应用 1 处");
      expect(result.warning).toContain("歧义跳过 1 处");
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, ".task-multi.redline-manifest.json"), "utf8"),
    ) as {
      applyResult?: { applied: number; attempted: number; ambiguous: number };
      proposals: Array<{ hunkId: string; applyStatus?: string }>;
    };
    expect(manifest.applyResult).toMatchObject({ applied: 1, attempted: 2, ambiguous: 1 });
    expect(manifest.proposals.find((p) => p.hunkId === "amb-1")?.applyStatus).toBe("ambiguous");
    expect(manifest.proposals.find((p) => p.hunkId === "ok-1")?.applyStatus).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("renderDocxWithTrackedChanges contract baseline", () => {
  it("does not template-rebuild when officecli apply fails on an existing Word", async () => {
    spawnState.setSucceeds = false;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tracked-base-"));
    const baseline = path.join(dir, "合同.docx");
    fs.writeFileSync(baseline, "pk");
    const result = await renderDocxWithTrackedChanges({
      draft: {
        taskId: "task-3",
        title: "Test",
        summary: "",
        templateId: "general",
        output: "docx",
        reviewStatus: "approved",
        reviewNotes: [],
        sections: [{ heading: "一", body: "乙", citations: [] }],
        createdAt: new Date().toISOString(),
        contractEdit: {
          baselineRelativePath: "合同.docx",
          mode: "surgical",
        },
      } as import("../types.js").ArtifactDraft,
      outputDir: dir,
      proposals: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "甲",
          after: "乙",
          status: "pending",
        },
      ],
      workspaceDir: dir,
      requireContractBaseline: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("tracked_apply_failed");
    }
  });
});
