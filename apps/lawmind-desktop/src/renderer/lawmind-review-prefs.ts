import { useEffect, useState } from "react";

const AUTO_EXPORT_KEY = "lawmind.review.autoExportOnApprove";
const REQUIRE_SIGNOFF_KEY = "lawmind.review.requireSignoffReview";

/** 设置页与对外流程配置共用，切换后立刻刷新待拍板。 */
export const REVIEW_PREFS_CHANGED_EVENT = "lawmind-review-prefs-changed";

/** Solo 默认开：未写过偏好时签批后自动导出 Word。显式 `"0"` 关闭。 */
export function readAutoExportOnApprove(): boolean {
  try {
    const v = localStorage.getItem(AUTO_EXPORT_KEY);
    if (v === null) {
      return true;
    }
    return v === "1";
  } catch {
    return true;
  }
}

export function writeAutoExportOnApprove(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_EXPORT_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 默认关：内部稿直接出结果；开了才把待审稿放回「待我拍板」。 */
export function readRequireSignoffReview(): boolean {
  try {
    return localStorage.getItem(REQUIRE_SIGNOFF_KEY) === "1";
  } catch {
    return false;
  }
}

function emitReviewPrefsChanged(): void {
  try {
    window.dispatchEvent(new Event(REVIEW_PREFS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

export function writeRequireSignoffReview(enabled: boolean): void {
  try {
    localStorage.setItem(REQUIRE_SIGNOFF_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  emitReviewPrefsChanged();
}

export function lawyerFacingDecisionTotal(input: {
  requiresDecisionTotal?: number;
  total?: number;
  pendingReviewCount?: number;
  requireSignoffReview: boolean;
}): number {
  const base = input.requiresDecisionTotal ?? input.total ?? 0;
  const extra = input.requireSignoffReview ? (input.pendingReviewCount ?? 0) : 0;
  return base + extra;
}

/** 待拍板范围：关开关不含签批稿。 */
export function lawyerFacingQueueScopeHint(requireSignoffReview: boolean): string {
  return requireSignoffReview ? "澄清、批准与签批" : "澄清、批准与待发信";
}

export function lawyerFacingQueueTabTitle(requireSignoffReview: boolean): string {
  return requireSignoffReview ? "待您拍板：外发、待补充与签批" : "待您拍板：外发与待补充";
}

export function useRequireSignoffReview(): boolean {
  const [value, setValue] = useState(readRequireSignoffReview);
  useEffect(() => {
    const sync = () => setValue(readRequireSignoffReview());
    window.addEventListener(REVIEW_PREFS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REVIEW_PREFS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return value;
}
