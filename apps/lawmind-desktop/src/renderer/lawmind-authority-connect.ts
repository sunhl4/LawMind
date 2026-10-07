/** Lawyer-facing text when the saved 北大法宝 token did not survive a live check. */
export function authorityProbeFailureText(body: unknown): string {
  const fallback = "令牌已保存，但北大法宝没有连上。请核对访问令牌和网络。";
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const probe = (body as { probe?: { error?: unknown } }).probe;
  const detail = typeof probe?.error === "string" ? probe.error.trim() : "";
  if (!detail) {
    return fallback;
  }
  return `令牌已保存，但北大法宝没有连上。${detail}`;
}
