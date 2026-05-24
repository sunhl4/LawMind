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

  it("findRelevantMemoriesForTurn returns at most 5", async () => {
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
    expect(hits.length).toBeLessThanOrEqual(5);
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
});
