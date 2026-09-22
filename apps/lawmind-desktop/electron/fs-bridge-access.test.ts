import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFsBridge } from "./fs-bridge.mjs";

/**
 * `access` 是必填项，目的就是让「新增写入口忘了加校验」不可能静默发生：
 * 漏传当场报错，写操作自动过可写根白名单。
 */
describe("resolveFsPath access gate", () => {
  // 用 realpath 后的根：macOS 的 /var → /private/var 会让 realpath 校验误判
  // 「symlink escapes root」。生产环境的根来自 userData / 原生选择器，本就是真实路径。
  const roots = () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lm-fsb-ws-")));
    const mount = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lm-fsb-mount-")));
    return { workspace, mount, map: { workspace, "mount:m1": mount } };
  };

  it("rejects a missing access argument instead of silently allowing it", () => {
    const { workspace, map } = roots();
    try {
      const bridge = createFsBridge(() => map);
      expect(() => bridge.resolveFsPath("workspace", "a.txt", {})).toThrow(
        /requires access: read\|write/,
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("blocks writes into a mount but allows reads", () => {
    const { workspace, mount, map } = roots();
    try {
      const bridge = createFsBridge(() => map);
      expect(() => bridge.resolveFsPath("mount:m1", "x.txt", { access: "write" })).toThrow(
        /本机文件夹默认不能改写/,
      );
      const read = bridge.resolveFsPath("mount:m1", "", { access: "read" });
      expect(read.absPath).toBe(mount);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(mount, { recursive: true, force: true });
    }
  });

  it("allows writes in the writable roots", () => {
    const { workspace, map } = roots();
    try {
      const bridge = createFsBridge(() => map);
      const resolved = bridge.resolveFsPath("workspace", "notes/a.md", { access: "write" });
      expect(resolved.absPath).toBe(path.join(workspace, "notes", "a.md"));
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
