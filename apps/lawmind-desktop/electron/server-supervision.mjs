/**
 * 本地服务器子进程崩溃监督（纯函数，electron-free，便于单测）。
 *
 * 策略：意外退出 → 指数退避自动重启；超过上限 → 放弃并表面化给用户。
 * 正常停止（killLocalServer / 手动重启 / 应用退出）不触发监督重启。
 */

function envMs(name, fallback) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const SERVER_SUPERVISION_DEFAULTS = Object.freeze({
  baseDelayMs: envMs("LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS", 500),
  factor: envMs("LAWMIND_E2E_SUPERVISION_FACTOR", 2),
  maxDelayMs: envMs("LAWMIND_E2E_SUPERVISION_MAX_DELAY_MS", 30_000),
  maxAttempts: envMs("LAWMIND_E2E_SUPERVISION_MAX_ATTEMPTS", 5),
});

/**
 * 第 attempt 次（1 起）监督重启前的退避毫秒数：
 * baseDelayMs * factor^(attempt-1)，封顶 maxDelayMs。确定性（无抖动），便于测试与日志对齐。
 */
export function computeSupervisionBackoffMs(attempt, opts = {}) {
  const { baseDelayMs, factor, maxDelayMs } = { ...SERVER_SUPERVISION_DEFAULTS, ...opts };
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, n - 1));
}

/** 是否还允许第 attempt 次监督重启（attempt > maxAttempts 时放弃）。 */
export function shouldAttemptSupervisedRestart(attempt, opts = {}) {
  const { maxAttempts } = { ...SERVER_SUPERVISION_DEFAULTS, ...opts };
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  return n <= maxAttempts;
}
