import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findRelevantMemoriesForTurn, scanMemoryManifest } from "./relevant-recall.js";

describe("relevant-recall", () => {
  it("scanMemoryManifest reads MEMORY index", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mem-"));
    fs.mkdirSync(path.join(ws, "memory", "topics"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "MEMORY.md"),
      "# Index\n- [合同](memory/topics/contract.md) — 合同要点\n",
      "utf8",
    );
    fs.writeFileSync(path.join(ws, "memory/topics/contract.md"), "# 合同\n", "utf8");
    const m = scanMemoryManifest(ws);
    expect(m.length).toBeGreaterThan(0);
  });

  it("findRelevantMemoriesForTurn returns at most 4 gists", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mem2-"));
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "- [诉状](memory/topics/lit.md) — 诉讼\n", "utf8");
    fs.mkdirSync(path.join(ws, "memory/topics"), { recursive: true });
    fs.writeFileSync(path.join(ws, "memory/topics/lit.md"), "# 诉状\n", "utf8");
    const hits = await findRelevantMemoriesForTurn({
      workspaceDir: ws,
      query: "诉讼诉状",
      alreadySurfaced: new Set(),
      recentToolNames: [],
    });
    expect(hits.length).toBeLessThanOrEqual(4);
    expect(hits.every((h) => typeof h.gist === "string")).toBe(true);
  });

  it("preferSmallFiles boosts smaller manifest entries", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mem3-"));
    fs.mkdirSync(path.join(ws, "memory", "topics"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "MEMORY.md"),
      "- [大](memory/topics/big.md) — 大文件\n- [小](memory/topics/small.md) — 小文件\n",
      "utf8",
    );
    fs.writeFileSync(path.join(ws, "memory/topics/big.md"), "# 大\n" + "x".repeat(20_000), "utf8");
    fs.writeFileSync(path.join(ws, "memory/topics/small.md"), "# 小\n短", "utf8");
    const hits = await findRelevantMemoriesForTurn({
      workspaceDir: ws,
      query: "文件",
      alreadySurfaced: new Set(),
      recentToolNames: ["read_file"],
      policy: { schemaVersion: 1, memoryRecall: { preferSmallFiles: true } },
    });
    expect(hits[0]?.relativePath).toContain("small.md");
  });

  it("returns empty when nothing scores above zero (no recent-file fallback)", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mem-zero-"));
    fs.mkdirSync(path.join(ws, "memory", "topics"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "MEMORY.md"),
      "- [无关](memory/topics/x.md) — 完全无关的笔记\n",
      "utf8",
    );
    fs.writeFileSync(path.join(ws, "memory/topics/x.md"), "# 天气\n晴天\n", "utf8");
    const hits = await findRelevantMemoriesForTurn({
      workspaceDir: ws,
      query: "zzzzqqqqnonsense",
      alreadySurfaced: new Set(),
      recentToolNames: [],
    });
    expect(hits).toEqual([]);
  });

  it("excludes MEMORY.md entries past validUntil", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mem-until-"));
    fs.mkdirSync(path.join(ws, "memory", "topics"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "MEMORY.md"),
      [
        "- [过期](memory/topics/old.md) — 旧习惯 validUntil:2020-01-01",
        "- [仍有效](memory/topics/live.md) — 诉讼写法 validUntil:2099-01-01",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(ws, "memory/topics/old.md"), "# 过期\n旧\n", "utf8");
    fs.writeFileSync(path.join(ws, "memory/topics/live.md"), "# 仍有效\n诉讼写法\n", "utf8");
    const manifest = scanMemoryManifest(ws);
    expect(manifest.find((e) => e.relativePath.includes("old.md"))?.validUntil).toBe("2020-01-01");
    expect(manifest.find((e) => e.relativePath.includes("live.md"))?.validUntil).toBe("2099-01-01");
    const hits = await findRelevantMemoriesForTurn({
      workspaceDir: ws,
      query: "诉讼",
      alreadySurfaced: new Set(),
      recentToolNames: [],
    });
    expect(hits.every((h) => !h.relativePath.includes("old.md"))).toBe(true);
    expect(hits.some((h) => h.relativePath.includes("live.md"))).toBe(true);
  });

  it("formatRelevantMemoryHitsForPrompt lists title path and gist", async () => {
    const { formatRelevantMemoryHitsForPrompt } = await import("./relevant-recall.js");
    expect(formatRelevantMemoryHitsForPrompt([])).toBe("");
    const block = formatRelevantMemoryHitsForPrompt([
      {
        relativePath: "memory/topics/lit.md",
        mtimeMs: 1,
        title: "诉状",
        gist: "诉讼要点",
      },
    ]);
    expect(block).toContain("相关记忆");
    expect(block).toContain("诉状");
    expect(block).toContain("memory/topics/lit.md");
    expect(block).toContain("诉讼要点");
  });
});
