import { describe, expect, it } from "vitest";
import {
  buildLawmindPopoutHash,
  parseLawmindPopoutRoute,
  shouldApplySavedPreviewOverLive,
} from "./lawmind-popout-route";

describe("lawmind-popout-route", () => {
  it("parses review-preview hash", () => {
    expect(parseLawmindPopoutRoute("#lm-popout=review-preview&taskId=abc%2F1")).toEqual({
      kind: "review-preview",
      taskId: "abc/1",
    });
  });

  it("returns null for main app hash", () => {
    expect(parseLawmindPopoutRoute("")).toBeNull();
    expect(parseLawmindPopoutRoute("#settings")).toBeNull();
  });

  it("round-trips hash builder", () => {
    const hash = buildLawmindPopoutHash({ kind: "review-preview", taskId: "t-1" });
    expect(parseLawmindPopoutRoute(`#${hash}`)).toEqual({
      kind: "review-preview",
      taskId: "t-1",
    });
  });

  it("does not let saved poll clobber fresh live editor values", () => {
    const now = 1_000_000;
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: null, now })).toBe(true);
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: now - 1_000, now })).toBe(false);
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: now - 20_000, now })).toBe(true);
  });
});
