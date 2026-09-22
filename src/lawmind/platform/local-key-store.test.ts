import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultLocalKeyDir,
  parseHexKey,
  resetLocalKeyStoreCacheForTests,
  resolveKeyFileKey,
} from "./local-key-store.js";

const tmpDirs: string[] = [];

function mkKeyDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-key-store-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetLocalKeyStoreCacheForTests();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("local-key-store", () => {
  it("parseHexKey accepts 64-hex and rejects others", () => {
    const valid = "ab".repeat(32);
    expect(parseHexKey(valid)).toHaveLength(32);
    expect(parseHexKey(` ${valid} `)).toHaveLength(32);
    expect(parseHexKey("zz".repeat(32))).toBeNull();
    expect(parseHexKey("ab".repeat(16))).toBeNull();
    expect(parseHexKey(undefined)).toBeNull();
    expect(parseHexKey("")).toBeNull();
  });

  it("generates key file on first use with 0600 and reuses it", () => {
    const dir = mkKeyDir();
    const first = resolveKeyFileKey({ name: "audit-chain", keyDir: dir });
    expect(first).toHaveLength(32);
    const keyPath = path.join(dir, "audit-chain.key");
    expect(fs.existsSync(keyPath)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    }
    resetLocalKeyStoreCacheForTests();
    const second = resolveKeyFileKey({ name: "audit-chain", keyDir: dir });
    expect(second?.equals(first)).toBe(true);
  });

  it("create:false does not generate a key", () => {
    const dir = mkKeyDir();
    expect(resolveKeyFileKey({ name: "mail-secrets", keyDir: dir, create: false })).toBeNull();
    expect(fs.existsSync(path.join(dir, "mail-secrets.key"))).toBe(false);
  });

  it("defaultLocalKeyDir honors LAWMIND_KEY_DIR override", () => {
    const dir = mkKeyDir();
    const prev = process.env.LAWMIND_KEY_DIR;
    process.env.LAWMIND_KEY_DIR = dir;
    try {
      expect(defaultLocalKeyDir()).toBe(path.resolve(dir));
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_KEY_DIR;
      } else {
        process.env.LAWMIND_KEY_DIR = prev;
      }
    }
  });
});
