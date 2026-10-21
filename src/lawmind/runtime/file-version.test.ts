import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileVersionOf } from "./file-version.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-file-version-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("fileVersionOf", () => {
  it("is undefined for a missing path, a directory, and a symlink", () => {
    const dir = tempDir();
    expect(fileVersionOf(path.join(dir, "nope.txt"))).toBeUndefined();
    expect(fileVersionOf(dir)).toBeUndefined();

    const target = path.join(dir, "target.txt");
    fs.writeFileSync(target, "内容");
    const link = path.join(dir, "link.txt");
    fs.symlinkSync(target, link);
    // O_NOFOLLOW：链接本身不是「同一份材料」，不能顺着去哈希别人的文件。
    expect(fileVersionOf(link)).toBeUndefined();
  });

  it("changes when a middle byte changes even with the timestamps restored", () => {
    const dir = tempDir();
    const file = path.join(dir, "证据.md");
    fs.writeFileSync(file, "甲方应于十日内付款。\n乙方负责验收。\n");
    const stamp = fs.statSync(file);
    const before = fileVersionOf(file);
    expect(before).toBeDefined();

    // 改中间一行，再把 mtime 按原样写回：只有全字节哈希还认得出来。
    fs.writeFileSync(file, "甲方应于五日内付款。\n乙方负责验收。\n");
    fs.utimesSync(file, stamp.atime, stamp.mtime);
    const after = fileVersionOf(file);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("is stable across repeated reads of an untouched file", () => {
    const dir = tempDir();
    const file = path.join(dir, "材料.txt");
    fs.writeFileSync(file, "同一份内容".repeat(1000));
    const first = fileVersionOf(file);
    expect(fileVersionOf(file)).toBe(first);
  });

  it("hashes files larger than one read chunk", () => {
    const dir = tempDir();
    const file = path.join(dir, "大文件.docx");
    // > 1 MiB：跨块读取后版本仍应对内容敏感。
    fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 7, 7));
    const before = fileVersionOf(file);
    expect(before).toContain(`${1024 * 1024 + 7}:`);
    const bytes = fs.readFileSync(file);
    bytes[1024 * 1024 + 6] = 8;
    fs.writeFileSync(file, bytes);
    expect(fileVersionOf(file)).not.toBe(before);
  });
});
