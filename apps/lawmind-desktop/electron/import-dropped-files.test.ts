import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  destRelForDroppedFile,
  importDroppedAbsPath,
  importDroppedAbsPaths,
} from "./import-dropped-files.mjs";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-import-drop-"));
}

describe("import-dropped-files", () => {
  let workspaceDir = "";

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("routes into case materials when a matter id is present", () => {
    expect(destRelForDroppedFile("临时讨论", "合同.docx")).toBe(
      "cases/临时讨论/materials/合同.docx",
    );
    expect(destRelForDroppedFile(null, "合同.docx")).toBe("uploads/合同.docx");
  });

  it("copies an outside file into uploads and avoids colliding names", () => {
    workspaceDir = tmpDir();
    const src = path.join(os.tmpdir(), `lm-drop-src-${Date.now()}.txt`);
    fs.writeFileSync(src, "hello");
    const first = importDroppedAbsPath({ workspaceDir, absPath: src });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.relPath).toBe("uploads/" + path.basename(src));
    expect(fs.readFileSync(path.join(workspaceDir, first.relPath), "utf8")).toBe("hello");

    const second = importDroppedAbsPath({ workspaceDir, absPath: src });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.relPath).not.toBe(first.relPath);
    expect(second.relPath.startsWith("uploads/")).toBe(true);
    fs.unlinkSync(src);
  });

  it("copies into the current matter materials folder", () => {
    workspaceDir = tmpDir();
    const src = path.join(workspaceDir, "..", `drop-matter-${Date.now()}.docx`);
    fs.writeFileSync(src, "docx");
    const result = importDroppedAbsPath({
      workspaceDir,
      absPath: src,
      matterId: "matter-nda",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.relPath).toBe(`cases/matter-nda/materials/${path.basename(src)}`);
    expect(fs.existsSync(path.join(workspaceDir, result.relPath))).toBe(true);
    fs.unlinkSync(src);
  });

  it("imports an outside directory tree into case materials", () => {
    workspaceDir = tmpDir();
    const dir = path.join(os.tmpdir(), `lm-drop-dir-${Date.now()}`);
    fs.mkdirSync(path.join(dir, "子目录"), { recursive: true });
    fs.writeFileSync(path.join(dir, "主合同.docx"), "docx");
    fs.writeFileSync(path.join(dir, "子目录", "清单.md"), "list");
    const result = importDroppedAbsPath({
      workspaceDir,
      absPath: dir,
      matterId: "matter-nda",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.kind).toBe("directory");
    expect(result.relPath).toBe(`cases/matter-nda/materials/${path.basename(dir)}`);
    expect(fs.readFileSync(path.join(workspaceDir, result.relPath, "主合同.docx"), "utf8")).toBe(
      "docx",
    );
    expect(
      fs.readFileSync(path.join(workspaceDir, result.relPath, "子目录", "清单.md"), "utf8"),
    ).toBe("list");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects missing files", () => {
    workspaceDir = tmpDir();
    expect(importDroppedAbsPath({ workspaceDir, absPath: "/no/such/file.docx" }).ok).toBe(false);
  });

  it("pins files already in the workspace without copying", () => {
    workspaceDir = tmpDir();
    const rel = "contracts/in-ws.txt";
    const abs = path.join(workspaceDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "keep");
    const result = importDroppedAbsPath({ workspaceDir, absPath: abs });
    expect(result).toMatchObject({
      ok: true,
      root: "workspace",
      relPath: rel,
      imported: false,
    });
    expect(fs.existsSync(path.join(workspaceDir, "uploads"))).toBe(false);
  });

  it("pins a workspace directory without copying", () => {
    workspaceDir = tmpDir();
    const rel = "contracts/2026";
    fs.mkdirSync(path.join(workspaceDir, rel), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, rel, "nda.docx"), "x");
    const result = importDroppedAbsPath({
      workspaceDir,
      absPath: path.join(workspaceDir, rel),
    });
    expect(result).toMatchObject({
      ok: true,
      root: "workspace",
      relPath: rel,
      kind: "directory",
      imported: false,
    });
  });

  it("collects mixed successes", () => {
    workspaceDir = tmpDir();
    const src = path.join(os.tmpdir(), `lm-drop-batch-${Date.now()}.md`);
    fs.writeFileSync(src, "# n");
    const batch = importDroppedAbsPaths({
      workspaceDir,
      absPaths: [src, "/no/such/file.docx"],
    });
    expect(batch.items).toHaveLength(1);
    expect(batch.errors.length).toBeGreaterThan(0);
    fs.unlinkSync(src);
  });
});
