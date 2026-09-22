import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingestMaterialsIncremental, ingestMaterialsRows } from "./fts-ingest-materials.js";
import { openSearchIndexDb, rebuildWorkspaceSearchIndex } from "./fts-ingest.js";
import { searchMaterials } from "./fts-search-materials.js";

describe("materials_fts (matter materials full-text)", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mat-fts-"));
    const dir = path.join(workspaceDir, "cases", "m-1", "materials");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "合同扫描件.txt"),
      "买卖合同正文：双方约定违约金按日万分之五计算，交货期为合同签订后三十日内。",
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "发票.txt"), "增值税普通发票，价税合计叁仟元整。", "utf8");
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("full ingest indexes text files and search returns relPath + page", async () => {
    const db = openSearchIndexDb(workspaceDir);
    const result = await ingestMaterialsRows(db, workspaceDir);
    db.close();
    expect(result.count).toBeGreaterThan(0);

    const found = await searchMaterials(workspaceDir, { q: "违约金按日万分之五", matterId: "m-1" });
    expect(found.hits.length).toBeGreaterThan(0);
    expect(found.hits[0]?.relPath).toBe("cases/m-1/materials/合同扫描件.txt");
    expect(found.hits[0]?.page).toBeGreaterThanOrEqual(1);
    expect(found.hits[0]?.snippet).toContain("违约金");
  });

  it("incremental ingest picks up new files and drops deleted ones by mtime", async () => {
    const db = openSearchIndexDb(workspaceDir);
    await ingestMaterialsRows(db, workspaceDir);
    const first = await ingestMaterialsIncremental(db, workspaceDir);
    expect(first.added).toBe(0);
    expect(first.removed).toBe(0);

    fs.writeFileSync(
      path.join(workspaceDir, "cases", "m-1", "materials", "补充协议.txt"),
      "补充协议：交货期延长至六十日。",
      "utf8",
    );
    const second = await ingestMaterialsIncremental(db, workspaceDir);
    expect(second.added).toBeGreaterThan(0);

    fs.rmSync(path.join(workspaceDir, "cases", "m-1", "materials", "发票.txt"));
    const third = await ingestMaterialsIncremental(db, workspaceDir);
    expect(third.removed).toBeGreaterThan(0);
    db.close();

    const found = await searchMaterials(workspaceDir, { q: "交货期延长", matterId: "m-1" });
    expect(found.hits.some((h) => h.fileName === "补充协议.txt")).toBe(true);
    const gone = await searchMaterials(workspaceDir, { q: "价税合计叁仟元", matterId: "m-1" });
    expect(gone.hits.length).toBe(0);
  });

  it("rebuild includes materials rows", async () => {
    const result = await rebuildWorkspaceSearchIndex(workspaceDir);
    expect(result.materialsRows).toBeGreaterThan(0);
  });
});
