import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyBundledProviderDefaults,
  BUNDLED_DEFAULTS_ENV_KEYS,
  bundledDefaultsCandidates,
  DISABLE_ENV,
  FILE_OVERRIDE_ENV,
  isBundledDefaultsDisabled,
  readBundledProviderDefaults,
} from "./bundled-provider-defaults.mjs";

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-bundled-defaults-"));
  tmpDirs.push(dir);
  return dir;
}

function writeDefaults(body: unknown, name = "provider-defaults.json"): string {
  const dir = tmpDir();
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return file;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readBundledProviderDefaults", () => {
  it("reads the shipped key and keeps only its name, never its value in the path", () => {
    const file = writeDefaults({
      schemaVersion: 1,
      env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789" },
    });
    const read = readBundledProviderDefaults({ override: file, env: {} });
    expect(read?.file).toBe(path.resolve(file));
    expect(read?.env).toEqual({ LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789" });
  });

  it("drops env names outside the provider-key allowlist", () => {
    const file = writeDefaults({
      env: {
        LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-ok-0123456789",
        // 这些会改变默认模型解析或把密钥送到别处，白名单之外。
        LAWMIND_AGENT_API_KEY: "sk-should-not-ship",
        LAWMIND_QWEN_API_KEY: "sk-should-not-ship",
        AWS_SECRET_ACCESS_KEY: "nope",
        LAWMIND_PROVIDER_DEEPSEEK_API_KEY_EMPTY: "   ",
      },
    });
    const read = readBundledProviderDefaults({ override: file, env: {} });
    expect(Object.keys(read?.env ?? {})).toEqual(["LAWMIND_PROVIDER_DEEPSEEK_API_KEY"]);
    expect(BUNDLED_DEFAULTS_ENV_KEYS).not.toContain("LAWMIND_AGENT_API_KEY");
  });

  it("treats a missing file as 'no bundled key' instead of throwing", () => {
    const missing = path.join(tmpDir(), "nope.json");
    expect(readBundledProviderDefaults({ override: missing, env: {} })).toBeNull();
  });

  it("treats malformed JSON or an empty env map as 'no bundled key'", () => {
    expect(readBundledProviderDefaults({ override: writeDefaults("{not json"), env: {} })).toBeNull();
    expect(readBundledProviderDefaults({ override: writeDefaults({ env: {} }), env: {} })).toBeNull();
    expect(
      readBundledProviderDefaults({
        override: writeDefaults({ env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "" } }),
        env: {},
      }),
    ).toBeNull();
  });

  it("honours the disable flag so support can prove a user's own key works", () => {
    const file = writeDefaults({ env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789" } });
    const read = readBundledProviderDefaults({
      override: file,
      env: { [DISABLE_ENV]: "1" },
    });
    expect(read).toBeNull();
  });

  it("stays off under E2E so the mock provider is never bypassed", () => {
    const file = writeDefaults({ env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789" } });
    expect(readBundledProviderDefaults({ override: file, env: { LAWMIND_E2E: "1" } })).toBeNull();
    expect(isBundledDefaultsDisabled({ LAWMIND_E2E: "1" })).toBe(true);
    expect(isBundledDefaultsDisabled({ LAWMIND_E2E: "0" })).toBe(false);
  });

  it("reads the override env var when no explicit path is passed", () => {
    const file = writeDefaults({ env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-env-0123456789" } });
    const read = readBundledProviderDefaults({ env: { [FILE_OVERRIDE_ENV]: file } });
    expect(read?.env.LAWMIND_PROVIDER_DEEPSEEK_API_KEY).toBe("sk-env-0123456789");
  });
});

describe("applyBundledProviderDefaults", () => {
  it("fills only gaps and leaves a user-configured provider key untouched", () => {
    const file = writeDefaults({
      env: {
        LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789",
        LAWMIND_PROVIDER_OPENAI_API_KEY: "sk-shipped-openai-0123456789",
      },
    });
    const env: Record<string, string> = { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-user-own-0123456789" };
    const result = applyBundledProviderDefaults({ override: file, env });
    expect(env.LAWMIND_PROVIDER_DEEPSEEK_API_KEY).toBe("sk-user-own-0123456789");
    expect(env.LAWMIND_PROVIDER_OPENAI_API_KEY).toBe("sk-shipped-openai-0123456789");
    expect(result.applied).toEqual(["LAWMIND_PROVIDER_OPENAI_API_KEY"]);
    expect(result.skipped).toEqual(["LAWMIND_PROVIDER_DEEPSEEK_API_KEY"]);
  });

  it("does nothing when there is no shipped file", () => {
    const env: Record<string, string> = {};
    const result = applyBundledProviderDefaults({ override: path.join(tmpDir(), "nope.json"), env });
    expect(result).toEqual({ file: "", applied: [], skipped: [] });
    expect(env).toEqual({});
  });

  it("does not override a shorter non-empty value that differs only by whitespace", () => {
    const file = writeDefaults({ env: { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "sk-shipped-0123456789" } });
    const env: Record<string, string> = { LAWMIND_PROVIDER_DEEPSEEK_API_KEY: "  sk-user-0123456789  " };
    applyBundledProviderDefaults({ override: file, env });
    expect(env.LAWMIND_PROVIDER_DEEPSEEK_API_KEY).toBe("  sk-user-0123456789  ");
  });
});

describe("bundledDefaultsCandidates", () => {
  it("prefers the packaged resources dir, then the repo dev dir", () => {
    const candidates = bundledDefaultsCandidates({
      env: {},
      resourcesPath: "/Applications/LawMind.app/Contents/Resources",
      electronDir: "/repo/apps/lawmind-desktop/electron",
    });
    expect(candidates).toEqual([
      path.join("/Applications/LawMind.app/Contents/Resources", "defaults", "provider-defaults.json"),
      path.join("/repo/apps/lawmind-desktop/electron", "..", "resources", "defaults", "provider-defaults.json"),
    ]);
  });

  it("returns exactly one path when an explicit override is set", () => {
    const candidates = bundledDefaultsCandidates({
      env: { [FILE_OVERRIDE_ENV]: "/tmp/x/provider-defaults.json" },
      resourcesPath: "/ignored",
      electronDir: "/ignored-too",
    });
    expect(candidates).toEqual([path.resolve("/tmp/x/provider-defaults.json")]);
  });
});
