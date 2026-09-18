import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMatterMaterialFiles, matterMaterialsDir } from "./matter-materials.js";

describe("listMatterMaterialFiles", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("lists nested files by mtime without hashing", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mats-"));
    tmp.push(workspaceDir);
    const dir = matterMaterialsDir(workspaceDir, "case-a");
    fs.mkdirSync(path.join(dir, "证据"), { recursive: true });
    fs.writeFileSync(path.join(dir, "合同.docx"), "hello");
    fs.writeFileSync(path.join(dir, "证据", "发票.pdf"), "pdf");
    const listed = listMatterMaterialFiles(workspaceDir, "case-a");
    expect(listed.map((f) => f.relPath).sort()).toEqual([
      "materials/合同.docx",
      "materials/证据/发票.pdf",
    ]);
    expect(listed.every((f) => f.size > 0 && f.updatedAt)).toBe(true);
  });

  it("returns empty when the materials folder is missing", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-mats-empty-"));
    tmp.push(workspaceDir);
    expect(listMatterMaterialFiles(workspaceDir, "case-missing")).toEqual([]);
  });
});
