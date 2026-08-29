import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addScanRoot, listScanRoots } from "./job-store.js";
import { runHistoricalScan } from "./run-scan.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("runHistoricalScan", () => {
  it("catalogs organized folders and messy leftovers, and queues knowledge", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-ws-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "x");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "y");
    fs.writeFileSync(path.join(root, "随便一份.pdf"), "z");
    const added = addScanRoot(ws, root, "历史卷宗");
    expect(added.ok).toBe(true);
    expect(listScanRoots(ws)).toHaveLength(1);

    const job = await runHistoricalScan(ws);
    expect(job.status).toBe("complete");
    expect(job.stats.cataloged).toBe(3);
    expect(job.stats.organizedFolders).toBe(1);
    expect(job.stats.messyFiles).toBeGreaterThanOrEqual(1);
    expect(job.stats.knowledgeQueued).toBe(1);
    expect(job.stats.incremental).toBe(false);
    expect(job.stats.filesUnchanged).toBe(0);
    expect(job.stats.filesChanged).toBe(3);
  });

  it("second run skips unchanged files and does not re-queue knowledge", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-inc-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-inc-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "x");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "y");
    expect(addScanRoot(ws, root, "历史卷宗").ok).toBe(true);

    const first = await runHistoricalScan(ws);
    expect(first.stats.knowledgeQueued).toBe(1);
    expect(first.catalogFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const second = await runHistoricalScan(ws);
    expect(second.stats.incremental).toBe(true);
    expect(second.stats.filesUnchanged).toBeGreaterThan(0);
    expect(second.stats.filesUnchanged).toBe(first.stats.cataloged);
    expect(second.stats.filesChanged).toBe(0);
    expect(second.stats.cataloged).toBe(first.stats.cataloged);
    expect(second.stats.knowledgeQueued).toBe(0);
    expect(second.catalogFingerprint).toBe(first.catalogFingerprint);
    const suggestions = path.join(ws, "memory-adoption", "suggestions.jsonl");
    const knowledgeLines = fs
      .readFileSync(suggestions, "utf8")
      .split("\n")
      .filter((line) => line.includes("historical.knowledge"));
    expect(knowledgeLines).toHaveLength(1);
  });

  it("detects a changed file by mtime/size and merges it into the catalog", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-chg-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-chg-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    const target = path.join(root, "华能采购案", "供货合同.docx");
    fs.writeFileSync(target, "x");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "y");
    expect(addScanRoot(ws, root, "历史卷宗").ok).toBe(true);

    const first = await runHistoricalScan(ws);
    expect(first.stats.cataloged).toBe(2);

    fs.appendFileSync(target, "changed");
    const second = await runHistoricalScan(ws);
    expect(second.stats.incremental).toBe(true);
    expect(second.stats.filesChanged).toBeGreaterThanOrEqual(1);
    expect(second.stats.filesUnchanged).toBeGreaterThanOrEqual(1);
    expect(second.stats.cataloged).toBe(2);
    const updated = second.catalog.find((i) => i.fileName === "供货合同.docx");
    expect(updated?.size).toBeGreaterThan(1);
  });

  it("incremental:false forces a full rescan", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-full-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-scan-full-root-"));
    dirs.push(ws, root);
    fs.mkdirSync(path.join(root, "华能采购案"), { recursive: true });
    fs.writeFileSync(path.join(root, "华能采购案", "供货合同.docx"), "x");
    fs.writeFileSync(path.join(root, "华能采购案", "补充协议.docx"), "y");
    expect(addScanRoot(ws, root, "历史卷宗").ok).toBe(true);

    const first = await runHistoricalScan(ws);
    expect(first.stats.cataloged).toBe(2);

    const full = await runHistoricalScan(ws, { incremental: false });
    expect(full.status).toBe("complete");
    expect(full.stats.incremental).toBe(false);
    expect(full.stats.filesUnchanged).toBe(0);
    expect(full.stats.filesChanged).toBe(2);
    expect(full.stats.cataloged).toBe(2);
    expect(full.catalog.map((i) => i.fileName).toSorted()).toEqual([
      "供货合同.docx",
      "补充协议.docx",
    ]);
  });
});
