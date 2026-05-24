const AUTO_EXPORT_KEY = "lawmind.review.autoExportOnApprove";

export function readAutoExportOnApprove(): boolean {
  try {
    return localStorage.getItem(AUTO_EXPORT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAutoExportOnApprove(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_EXPORT_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
