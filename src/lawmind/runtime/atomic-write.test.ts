import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteFile } from "./atomic-write.js";
import { fileVersionOf } from "./file-version.js";
import { checkTurnFileVersion, recordTurnFileVersion } from "./turn-file-versions.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-atomic-"));
}

describe("atomicWriteFile", () => {
  it("writes content and leaves no temp file behind", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "意见.md");
    const result = await atomicWriteFile(file, "正文");
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("正文");
    expect(fs.readdirSync(dir)).toEqual(["意见.md"]);
  });

  it("refuses to overwrite when expectedVersion no longer matches", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "原件.md");
    fs.writeFileSync(file, "律师刚改过的内容", "utf8");
    const stale = "1:0:deadbeef";
    const result = await atomicWriteFile(file, "模型写入", { expectedVersion: stale });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("version_conflict");
    expect(fs.readFileSync(file, "utf8")).toBe("律师刚改过的内容");
  });

  it("detects a middle-only edit even if file size and mtime are preserved", () => {
    const dir = tmpDir();
    const file = path.join(dir, "large.txt");
    const content = Buffer.alloc(200_000, 65);
    fs.writeFileSync(file, content);
    const stamp = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(file, stamp, stamp);
    const before = fileVersionOf(file);
    content[100_000] = 66;
    fs.writeFileSync(file, content);
    fs.utimesSync(file, stamp, stamp);
    expect(fileVersionOf(file)).not.toBe(before);
  });

  it("refuses deletion and cancellation rather than recreating or overwriting an original", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "original.txt");
    fs.writeFileSync(file, "original");
    const expectedVersion = fileVersionOf(file)!;
    fs.unlinkSync(file);
    expect(await atomicWriteFile(file, "replacement", { expectedVersion })).toMatchObject({
      ok: false,
      code: "version_conflict",
    });
    const signal = AbortSignal.abort();
    expect(await atomicWriteFile(file, "replacement", { signal })).toMatchObject({
      ok: false,
      code: "aborted",
    });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not treat an existing symlink as an absent destination", async () => {
    const dir = tmpDir();
    const target = path.join(dir, "target.txt");
    const link = path.join(dir, "link.txt");
    fs.writeFileSync(target, "original");
    fs.symlinkSync(target, link);
    expect(await atomicWriteFile(link, "replacement", { expectedVersion: "" })).toMatchObject({
      ok: false,
      code: "io_error",
    });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });

  it("writes when expectedVersion matches", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "草稿.md");
    fs.writeFileSync(file, "v1", "utf8");
    const version = fileVersionOf(file);
    expect(version).toBeTruthy();
    const result = await atomicWriteFile(file, "v2", { expectedVersion: version });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("v2");
  });
});

describe("turn file version ledger", () => {
  it("records the first touch and blocks a later write after external change", () => {
    const dir = tmpDir();
    const file = path.join(dir, "合同.md");
    fs.writeFileSync(file, "原稿", "utf8");
    const ctx: { turnFileVersions?: Record<string, string> } = {};

    expect(checkTurnFileVersion(ctx, "合同.md", file).ok).toBe(true);
    recordTurnFileVersion(ctx, "合同.md", file);
    expect(checkTurnFileVersion(ctx, "合同.md", file).ok).toBe(true);

    // 律师在 Finder 里改了原件。
    fs.writeFileSync(file, "律师改过的稿", "utf8");
    const conflict = checkTurnFileVersion(ctx, "合同.md", file);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) {
      return;
    }
    expect(conflict.error).toContain("已被改动");
    expect(conflict.currentVersion).toBeTruthy();
  });

  it("allows new files without a baseline", () => {
    const dir = tmpDir();
    const ctx: { turnFileVersions?: Record<string, string> } = {};
    expect(checkTurnFileVersion(ctx, "new.md", path.join(dir, "new.md")).ok).toBe(true);
  });
});
