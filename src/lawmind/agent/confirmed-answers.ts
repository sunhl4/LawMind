/**
 * Lawyer-confirmed clarification answers — bounded evidence for the Guardian.
 * The writer still sees the resume message; this structured copy is for the
 * independent reviewer only (not a coverage self-score).
 */

const MAX_KEYS = 12;
const MAX_VALUE = 200;

export function mergeConfirmedAnswers(
  prior?: Record<string, string>,
  incoming?: Record<string, string>,
): Record<string, string> | undefined {
  const out: Record<string, string> = { ...prior };
  for (const [rawKey, rawValue] of Object.entries(incoming ?? {})) {
    const key = rawKey.trim();
    const value = String(rawValue ?? "").trim();
    if (!key || !value) {
      continue;
    }
    out[key] = value.slice(0, MAX_VALUE);
  }
  const entries = Object.entries(out).filter(([k, v]) => k && v);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries.slice(-MAX_KEYS));
}
