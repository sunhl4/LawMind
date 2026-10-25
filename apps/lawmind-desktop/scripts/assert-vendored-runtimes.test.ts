import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertVendoredRuntimes,
  parseArchList,
  readMachOArch,
  runtimePaths,
} from "./assert-vendored-runtimes.mjs";

const MB = 1024 * 1024;

function writeFakeRuntime(root, platform, arch, { node = true, officecli = true } = {}) {
  const paths = runtimePaths({ platform, arch, desktopRoot: root });
  if (node) {
    fs.mkdirSync(path.dirname(paths.nodeBin), { recursive: true });
    fs.writeFileSync(paths.nodeBin, Buffer.alloc(2 * MB));
  }
  if (officecli) {
    fs.mkdirSync(path.dirname(paths.officecliBin), { recursive: true });
    fs.writeFileSync(paths.officecliBin, Buffer.alloc(2 * MB));
  }
  return paths;
}

function machO(cputype) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cputype, 4);
  return header;
}

describe("parseArchList", () => {
  it("defaults to the host arch", () => {
    expect(parseArchList("")).toEqual([process.arch]);
  });

  it("parses a comma list and dedupes", () => {
    expect(parseArchList("arm64,x64")).toEqual(["arm64", "x64"]);
    expect(parseArchList("arm64, arm64 ")).toEqual(["arm64"]);
  });

  it("rejects unknown arches instead of silently building the host one", () => {
    expect(() => parseArchList("ia32")).toThrow(/不支持的架构/);
  });
});

describe("readMachOArch", () => {
  it("reads arm64 and x64 from the Mach-O header", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-macho-"));
    try {
      const arm = path.join(dir, "arm");
      const x64 = path.join(dir, "x64");
      const elf = path.join(dir, "elf");
      fs.writeFileSync(arm, machO(0x0100000c));
      fs.writeFileSync(x64, machO(0x01000007));
      fs.writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]));
      expect(readMachOArch(arm)).toBe("arm64");
      expect(readMachOArch(x64)).toBe("x64");
      expect(readMachOArch(elf)).toBe("");
      expect(readMachOArch(path.join(dir, "missing"))).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("assertVendoredRuntimes", () => {
  it("passes when both arches are vendored", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rt-"));
    try {
      writeFakeRuntime(root, "darwin", "arm64");
      writeFakeRuntime(root, "darwin", "x64");
      const result = assertVendoredRuntimes({
        archList: ["arm64", "x64"],
        platform: "darwin",
        desktopRoot: root,
        detectArch: () => "",
      });
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.checked.map((item) => item.key)).toEqual(["darwin-arm64", "darwin-x64"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails with an actionable message when the arch was never vendored", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rt-miss-"));
    try {
      writeFakeRuntime(root, "darwin", "arm64");
      const result = assertVendoredRuntimes({
        archList: ["arm64", "x64"],
        platform: "darwin",
        desktopRoot: root,
        detectArch: () => "",
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join("\n")).toContain("darwin-x64");
      expect(result.problems.join("\n")).toContain("pnpm vendor:node --arch x64");
      expect(result.problems.join("\n")).toContain("pnpm vendor:officecli --arch x64");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when the vendored binary is the wrong architecture", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rt-arch-"));
    try {
      writeFakeRuntime(root, "darwin", "x64");
      // 把 arm64 的 node 塞进 x64 目录：文件在、体积够，但架构不对。
      const result = assertVendoredRuntimes({
        archList: ["x64"],
        platform: "darwin",
        desktopRoot: root,
        detectArch: () => "arm64",
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join("\n")).toContain("文件是 arm64，目标是 x64");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects placeholder/truncated binaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rt-small-"));
    try {
      const paths = runtimePaths({ platform: "darwin", arch: "arm64", desktopRoot: root });
      fs.mkdirSync(path.dirname(paths.nodeBin), { recursive: true });
      fs.writeFileSync(paths.nodeBin, "");
      const result = assertVendoredRuntimes({
        archList: ["arm64"],
        platform: "darwin",
        desktopRoot: root,
        detectArch: () => "",
      });
      expect(result.ok).toBe(false);
      expect(result.problems.join("\n")).toContain("不是有效文件");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
