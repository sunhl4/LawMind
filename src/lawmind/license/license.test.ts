/** 测试用密钥对（与内嵌公钥无关的独立对，用于验证拒绝路径）。 */
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activateLicense,
  clearLicense,
  licenseFilePath,
  machineFingerprint,
  resolveLicenseState,
  signActivationCode,
  TRIAL_DAYS,
  verifyActivationCode,
  type LicensePayload,
} from "./index.js";

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyDerB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeyDerB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

describe("license (offline, soft gate)", () => {
  let home: string;
  const keys = makeKeys();

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-license-home-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
    return {
      v: 1,
      edition: "solo",
      licensee: "张三律师",
      issuedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("starts a trial on first resolve and reports remaining days", () => {
    const state = resolveLicenseState({ homeDir: home });
    expect(state.status).toBe("trial");
    expect(state.trialDaysLeft).toBe(TRIAL_DAYS);
    expect(state.blocking).toBe(false);
    expect(fs.existsSync(licenseFilePath(home))).toBe(true);
  });

  it("never re-starts the trial on later reads", () => {
    const first = resolveLicenseState({ homeDir: home });
    expect(first.status).toBe("trial");
    const later = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const second = resolveLicenseState({ homeDir: home, now: later });
    expect(second.trialDaysLeft).toBe(TRIAL_DAYS - 5);
  });

  it("reports an expired trial without blocking work", () => {
    resolveLicenseState({ homeDir: home });
    const afterTrial = new Date(Date.now() + (TRIAL_DAYS + 3) * 24 * 60 * 60 * 1000);
    const state = resolveLicenseState({ homeDir: home, now: afterTrial });
    expect(state.status).toBe("trial_expired");
    expect(state.trialDaysLeft).toBe(0);
    expect(state.blocking).toBe(false);
    expect(state.message).toContain("功能照常可用");
  });

  it("accepts a correctly signed, machine-bound activation code", () => {
    const code = signActivationCode(
      payload({ machineFingerprint: machineFingerprint() }),
      keys.privateKeyDerB64,
    );
    const check = verifyActivationCode(code, {
      fingerprint: machineFingerprint(),
      publicKeyDerB64: keys.publicKeyDerB64,
    });
    expect(check.ok).toBe(true);
    const result = activateLicense(code, { homeDir: home });
    // 内嵌公钥与测试密钥对不同 → 拒绝写入（验证「不宽容通过」）。
    expect(result.ok).toBe(false);
  });

  it("saves and reports a licensed state with the embedded dev key", async () => {
    // 内置公钥对应的私钥（开发密钥对，见 scripts/lawmind/lawmind-license.ts 的换钥说明）。
    const { DEV_LICENSE_PRIVATE_KEY_DER_B64 } =
      await import("../../../scripts/lawmind/lawmind-license.js");
    const code = signActivationCode(
      payload({ expiresAt: "2099-01-01T00:00:00.000Z" }),
      DEV_LICENSE_PRIVATE_KEY_DER_B64,
    );
    const result = activateLicense(code, { homeDir: home });
    expect(result.ok).toBe(true);
    const state = resolveLicenseState({ homeDir: home });
    expect(state.status).toBe("licensed");
    expect(state.licensee).toBe("张三律师");
    expect(state.edition).toBe("solo");
    expect(state.blocking).toBe(false);
    // 激活码原文落盘（0600），续期只需再激活一次。
    const stored = JSON.parse(fs.readFileSync(licenseFilePath(home), "utf8")) as {
      activationCode?: string;
    };
    expect(stored.activationCode).toBe(code);
  });

  it("reports an expired license as soft (still usable)", async () => {
    const { DEV_LICENSE_PRIVATE_KEY_DER_B64 } =
      await import("../../../scripts/lawmind/lawmind-license.js");
    const code = signActivationCode(
      payload({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      DEV_LICENSE_PRIVATE_KEY_DER_B64,
    );
    expect(activateLicense(code, { homeDir: home }).ok).toBe(true);
    const state = resolveLicenseState({ homeDir: home });
    expect(state.status).toBe("licensed_expired");
    expect(state.blocking).toBe(false);
    expect(state.message).toContain("可继续使用");
  });

  it("rejects a tampered payload (signature covers the bytes)", () => {
    const code = signActivationCode(payload(), keys.privateKeyDerB64);
    const [, sig] = code.split(".");
    const tampered = `${Buffer.from(
      JSON.stringify(payload({ licensee: "李四律师" })),
      "utf8",
    ).toString("base64url")}.${sig}`;
    const check = verifyActivationCode(tampered, {
      fingerprint: machineFingerprint(),
      publicKeyDerB64: keys.publicKeyDerB64,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("bad_signature");
    }
  });

  it("rejects malformed codes and machine mismatches", () => {
    expect(verifyActivationCode("not-a-code").ok).toBe(false);
    expect(verifyActivationCode("").ok).toBe(false);
    const bound = signActivationCode(
      payload({ machineFingerprint: "someone-elses-machine" }),
      keys.privateKeyDerB64,
    );
    const check = verifyActivationCode(bound, {
      fingerprint: machineFingerprint(),
      publicKeyDerB64: keys.publicKeyDerB64,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("machine_mismatch");
    }
  });

  it("clearLicense returns to the trial/expired scale", () => {
    const code = signActivationCode(payload(), keys.privateKeyDerB64);
    activateLicense(code, { homeDir: home });
    clearLicense({ homeDir: home });
    const state = resolveLicenseState({ homeDir: home });
    expect(["trial", "trial_expired"]).toContain(state.status);
  });

  it("writes the license file outside any workspace and with 0600 perms", () => {
    resolveLicenseState({ homeDir: home });
    const p = licenseFilePath(home);
    expect(p.startsWith(path.join(home, ".lawmind"))).toBe(true);
    const mode = fs.statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
