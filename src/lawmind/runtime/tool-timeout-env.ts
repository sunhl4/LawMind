/**
 * Tool execution timeout from env.
 * Unset uses {@link DEFAULT_TOOL_WALL_TIMEOUT_MS} at the call sites.
 * Explicit `0` means no wall-clock kill (only user Stop / turn abort).
 */

/** Ordinary tools. Long enough for a statute lookup or a short officecli call. */
export const DEFAULT_TOOL_WALL_TIMEOUT_MS = 180_000;

/**
 * Nested model tools and Word export (Guardian + officecli) need longer than
 * the ordinary wall. Applied only when the configured timeout is still the
 * product default, so an explicit LAWMIND_TOOL_TIMEOUT_MS is honored.
 */
export const LONG_RUNNING_TOOL_TIMEOUT_MS = 12 * 60 * 1000;

export const LONG_RUNNING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "draft_worker",
  "explore_folder",
  "deep_research",
  "research_task",
  "delegate_task",
  "render_document",
  "render_tracked_draft",
]);

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

/**
 * Wall clock for one tool call.
 * `0` stays unlimited. Nested model / Word tools raised off the 3-minute
 * default so a real draft or export is not killed mid-flight.
 */
export function resolveToolWallTimeoutMs(toolName: string, configured: number): number {
  if (isUnlimitedToolTimeoutMs(configured)) {
    return configured;
  }
  if (LONG_RUNNING_TOOL_NAMES.has(toolName) && configured === DEFAULT_TOOL_WALL_TIMEOUT_MS) {
    return LONG_RUNNING_TOOL_TIMEOUT_MS;
  }
  return configured;
}
