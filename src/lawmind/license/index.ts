/**
 * 离线许可（软门槛）— 对外入口。
 *
 * 无网络、无远程控制面：只校验本机 `~/.lawmind/license.json` 里的 ed25519 激活码，
 * 试用期到期也只提醒不锁功能。
 */

export { LICENSE_DIR_NAME, LICENSE_FILE_NAME, LICENSE_PUBLIC_KEY_DER_B64 } from "./keys.js";
export {
  machineFingerprint,
  signActivationCode,
  verifyActivationCode,
  type ActivationCheck,
} from "./verify.js";
export {
  activateLicense,
  clearLicense,
  ensureTrialStarted,
  licenseDir,
  licenseFilePath,
  resolveLicenseState,
  type ActivateResult,
  type LicenseFile,
} from "./store.js";
export {
  TRIAL_DAYS,
  type LicenseEdition,
  type LicensePayload,
  type LicenseState,
} from "./types.js";
