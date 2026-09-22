/**
 * Tool execution timeout from env.
 * 0 = no cap (only user Stop / turn abort cancels). Unset defaults to 0.
 */

/** Parse LAWMIND_TOOL_TIMEOUT_MS; invalid values fall back to `fallback`. */
export function parseToolTimeoutMsEnv(fallback = 0, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LAWMIND_TOOL_TIMEOUT_MS?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

/** True when pipeline should not install a wall-clock tool kill. */
export function isUnlimitedToolTimeoutMs(toolTimeoutMs: number): boolean {
  return !(toolTimeoutMs > 0);
}
