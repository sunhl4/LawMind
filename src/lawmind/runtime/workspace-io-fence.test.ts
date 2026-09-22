import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fenceAgentFilePath } from "./workspace-io-fence.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("fenceAgentFilePath", () => {
  it("allows ordinary files under the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-ok-"));
    dirs.push(root);
    const abs = path.join(root, "notes.md");
    fs.writeFileSync(abs, "ok", "utf8");
    const fenced = fenceAgentFilePath({ rootDir: root, abs, homeDir: root });
    expect(fenced.ok).toBe(true);
    if (fenced.ok) {
      expect(fenced.abs).toBe(fs.realpathSync(abs));
      expect(fenced.rel).toBe("notes.md");
    }
  });

  it("denies .env even when it sits inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-env-"));
    dirs.push(root);
    const abs = path.join(root, ".env");
    fs.writeFileSync(abs, "SECRET=1", "utf8");
    const fenced = fenceAgentFilePath({ rootDir: root, abs, homeDir: root });
    expect(fenced.ok).toBe(false);
  });

  it("denies a symlink that escapes the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fence-out-"));
    dirs.push(root, outside);
    const secret = path.join(outside, "secret-client.md");
    fs.writeFileSync(secret, "other matter", "utf8");
    const link = path.join(root, "innocent.md");
    fs.symlinkSync(secret, link);
    const fenced = fenceAgentFilePath({ rootDir: root, abs: link, homeDir: root });
    expect(fenced.ok).toBe(false);
  });
});
