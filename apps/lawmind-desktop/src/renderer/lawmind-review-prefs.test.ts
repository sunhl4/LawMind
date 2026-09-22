/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lawyerFacingDecisionTotal,
  lawyerFacingQueueScopeHint,
  lawyerFacingQueueTabTitle,
  readAutoExportOnApprove,
  readRequireSignoffReview,
  writeAutoExportOnApprove,
  writeRequireSignoffReview,
} from "./lawmind-review-prefs";

function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  };
}

describe("lawmind-review-prefs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults auto-export on when preference unset", () => {
    expect(readAutoExportOnApprove()).toBe(true);
  });

  it("respects explicit off", () => {
    writeAutoExportOnApprove(false);
    expect(readAutoExportOnApprove()).toBe(false);
  });

  it("respects explicit on", () => {
    writeAutoExportOnApprove(true);
    expect(readAutoExportOnApprove()).toBe(true);
  });

  it("defaults 签批审阅 off", () => {
    expect(readRequireSignoffReview()).toBe(false);
  });

  it("persists 签批审阅 on/off", () => {
    writeRequireSignoffReview(true);
    expect(readRequireSignoffReview()).toBe(true);
    writeRequireSignoffReview(false);
    expect(readRequireSignoffReview()).toBe(false);
  });

  it("adds pending-review count to 待拍板 only when 签批审阅 is on", () => {
    expect(
      lawyerFacingDecisionTotal({
        requiresDecisionTotal: 1,
        pendingReviewCount: 4,
        requireSignoffReview: false,
      }),
    ).toBe(1);
    expect(
      lawyerFacingDecisionTotal({
        requiresDecisionTotal: 1,
        pendingReviewCount: 4,
        requireSignoffReview: true,
      }),
    ).toBe(5);
  });

  it("names 待拍板 scope from the 签批审阅 pref", () => {
    expect(lawyerFacingQueueScopeHint(false)).toBe("澄清、批准与待发信");
    expect(lawyerFacingQueueScopeHint(true)).toBe("澄清、批准与签批");
    expect(lawyerFacingQueueTabTitle(false)).toBe("待您拍板：外发与待补充");
    expect(lawyerFacingQueueTabTitle(true)).toBe("待您拍板：外发、待补充与签批");
  });
});
