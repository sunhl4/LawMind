/**
 * 许可状态机（软门槛）。
 *
 * 状态落盘在 `~/.lawmind/license.json`（工作区外，与 keys/ 同级）；
 * 许可文件本身永不被 agent 工具读取——它在工作区外，host 访问围栏也拦。
 *
 * 软门槛口径：到期/未激活只提醒，不阻断交办（律师产品的信任优先）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LICENSE_DIR_NAME, LICENSE_FILE_NAME } from "./keys.js";
import { TRIAL_DAYS, type LicenseState } from "./types.js";
import { machineFingerprint, verifyActivationCode } from "./verify.js";

export type LicenseFile = {
  schemaVersion: 1;
  /** 首次运行日（试用起算）。ISO。 */
  trialStartedAt: string;
  /** 已保存的激活码（原文）。 */
  activationCode?: string;
  /** 最近一次激活时间。 */
  activatedAt?: string;
};

export function licenseDir(homeDir?: string): string {
  return path.join(homeDir?.trim() || os.homedir(), LICENSE_DIR_NAME);
}

export function licenseFilePath(homeDir?: string): string {
  return path.join(licenseDir(homeDir), LICENSE_FILE_NAME);
}

function readLicenseFile(homeDir?: string): LicenseFile | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(licenseFilePath(homeDir), "utf8")) as LicenseFile;
    if (raw && typeof raw.trialStartedAt === "string") {
      return raw;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeLicenseFile(file: LicenseFile, homeDir?: string): void {
  const dir = licenseDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(licenseFilePath(homeDir), `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/** 首次运行时落试用起算日；已存在则原样返回（不改写，避免「续试用」）。 */
export function ensureTrialStarted(homeDir?: string, now = new Date()): LicenseFile {
  const existing = readLicenseFile(homeDir);
  if (existing) {
    return existing;
  }
  const created: LicenseFile = { schemaVersion: 1, trialStartedAt: now.toISOString() };
  writeLicenseFile(created, homeDir);
  return created;
}

function daysBetween(fromIso: string, to: Date): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) {
    return 0;
  }
  return Math.floor((to.getTime() - from) / (24 * 60 * 60 * 1000));
}

/**
 * 解析当前许可状态。`blocking` 恒为 false：UI 只提醒，不挡交办。
 */
export function resolveLicenseState(opts?: { homeDir?: string; now?: Date }): LicenseState {
  const now = opts?.now ?? new Date();
  const file = ensureTrialStarted(opts?.homeDir, now);
  const trialDaysLeft = Math.max(0, TRIAL_DAYS - daysBetween(file.trialStartedAt, now));

  const code = file.activationCode?.trim();
  if (code) {
    const check = verifyActivationCode(code, { fingerprint: machineFingerprint() });
    if (check.ok) {
      const { payload } = check;
      const expiresAt =
        typeof payload.expiresAt === "string" && Number.isFinite(Date.parse(payload.expiresAt))
          ? payload.expiresAt
          : undefined;
      const expired = Boolean(expiresAt && Date.parse(expiresAt) < now.getTime());
      if (expired && expiresAt) {
        return {
          status: "licensed_expired",
          edition: payload.edition,
          licensee: payload.licensee,
          expiresAt,
          message: `许可已于 ${expiresAt.slice(0, 10)} 到期（${payload.licensee}）。可继续使用，请续期以免失去更新与支持。`,
          blocking: false,
        };
      }
      return {
        status: "licensed",
        edition: payload.edition,
        licensee: payload.licensee,
        ...(expiresAt ? { expiresAt } : {}),
        message: `已激活：${payload.licensee}（${payload.edition}）${
          expiresAt ? `，有效期至 ${expiresAt.slice(0, 10)}` : ""
        }。`,
        blocking: false,
      };
    }
    const reasonZh =
      check.reason === "machine_mismatch"
        ? "该激活码绑定的是另一台机器"
        : check.reason === "bad_signature"
          ? "签名校验失败（激活码可能被改动）"
          : check.reason === "bad_payload"
            ? "激活码内容不完整"
            : "激活码格式不正确";
    return {
      status: "invalid",
      trialDaysLeft,
      message: `激活码无效：${reasonZh}。当前仍按试用/可用状态运行，可继续交办。`,
      blocking: false,
    };
  }

  if (trialDaysLeft > 0) {
    return {
      status: "trial",
      trialDaysLeft,
      message: `试用中，剩余 ${trialDaysLeft} 天。试用期结束不会锁住功能，只会提醒激活。`,
      blocking: false,
    };
  }
  return {
    status: "trial_expired",
    trialDaysLeft: 0,
    message: `试用已结束（自 ${file.trialStartedAt.slice(0, 10)} 起 ${TRIAL_DAYS} 天）。功能照常可用；请在设置 → 许可 里激活以继续获得更新与支持。`,
    blocking: false,
  };
}

export type ActivateResult =
  | { ok: true; state: LicenseState }
  | { ok: false; error: string; reason: string };

/** 校验并保存激活码。签名/指纹不过一律拒绝写入。 */
export function activateLicense(
  code: string,
  opts?: { homeDir?: string; now?: Date },
): ActivateResult {
  const now = opts?.now ?? new Date();
  const check = verifyActivationCode(code, { fingerprint: machineFingerprint() });
  if (!check.ok) {
    const message =
      check.reason === "machine_mismatch"
        ? "该激活码绑定的是另一台机器，请在签发时提供本机指纹。"
        : check.reason === "bad_signature"
          ? "激活码签名校验失败，已拒绝写入。"
          : "激活码格式或内容不正确。";
    return { ok: false, error: message, reason: check.reason };
  }
  const file = ensureTrialStarted(opts?.homeDir, now);
  writeLicenseFile(
    { ...file, activationCode: code.trim(), activatedAt: now.toISOString() },
    opts?.homeDir,
  );
  return { ok: true, state: resolveLicenseState({ homeDir: opts?.homeDir, now }) };
}

/** 清除已保存的激活码（回到试用/到期口径）。 */
export function clearLicense(opts?: { homeDir?: string }): void {
  const file = readLicenseFile(opts?.homeDir);
  if (!file) {
    return;
  }
  const { activationCode: _drop, activatedAt: _dropAt, ...rest } = file;
  writeLicenseFile({ ...rest, schemaVersion: 1 }, opts?.homeDir);
}
