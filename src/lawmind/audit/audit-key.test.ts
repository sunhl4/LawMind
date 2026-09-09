import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetLocalKeyStoreCacheForTests } from "../platform/local-key-store.js";
import { AUDIT_CHAIN_KEY_ENV, resolveAuditChainKey, resolveAuditChainKeys } from "./audit-key.js";

const tmpDirs: string[] = [];

function mkKeyDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-key-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetLocalKeyStoreCacheForTests();
  delete process.env[AUDIT_CHAIN_KEY_ENV];
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("audit-key", () => {
  it("env key takes priority and is the emit key", () => {
    const dir = mkKeyDir();
    const envHex = "cd".repeat(32);
    process.env[AUDIT_CHAIN_KEY_ENV] = envHex;
    const keys = resolveAuditChainKeys({ keyDir: dir });
    expect(keys.length).toBe(2);
    expect(keys[0].toString("hex")).toBe(envHex);
    expect(resolveAuditChainKey({ keyDir: dir })?.toString("hex")).toBe(envHex);
  });

  it("dedupes when env key equals key file content", () => {
    const dir = mkKeyDir();
    const fileKey = resolveAuditChainKey({ keyDir: dir });
    expect(fileKey).not.toBeNull();
    process.env[AUDIT_CHAIN_KEY_ENV] = fileKey.toString("hex");
    expect(resolveAuditChainKeys({ keyDir: dir })).toHaveLength(1);
  });

  it("verify-side resolution (create:false) does not mint a fresh key", () => {
    const dir = mkKeyDir();
    expect(resolveAuditChainKeys({ keyDir: dir, create: false })).toHaveLength(0);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("ignores malformed env key and falls back to key file", () => {
    const dir = mkKeyDir();
    process.env[AUDIT_CHAIN_KEY_ENV] = "not-hex";
    const key = resolveAuditChainKey({ keyDir: dir });
    expect(key).toHaveLength(32);
    expect(fs.existsSync(path.join(dir, "audit-chain.key"))).toBe(true);
  });
});
