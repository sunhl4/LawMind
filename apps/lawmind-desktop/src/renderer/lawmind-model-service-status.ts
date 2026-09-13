/** Lawyer-facing status for the main chat model (key present ≠ vendor accepted it). */
export function modelServiceStatus(opts: {
  configured?: boolean;
  verified?: boolean;
}): { label: "待配置" | "待验证" | "已验证"; ok: boolean } {
  if (!opts.configured) {
    return { label: "待配置", ok: false };
  }
  if (opts.verified) {
    return { label: "已验证", ok: true };
  }
  return { label: "待验证", ok: false };
}
