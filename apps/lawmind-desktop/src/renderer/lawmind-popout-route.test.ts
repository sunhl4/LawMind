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

  it("round-trips a detached chat pane", () => {
    const hash = buildLawmindPopoutHash({
      kind: "workspace-pane",
      pane: "chat",
      title: "对话 · 某案",
      sessionId: "s-1",
      assistantId: "a-1",
      matterId: "m-1",
    });
    expect(parseLawmindPopoutRoute(`#${hash}`)).toEqual({
      kind: "workspace-pane",
      pane: "chat",
      title: "对话 · 某案",
      sessionId: "s-1",
      assistantId: "a-1",
      matterId: "m-1",
    });
  });

  it("round-trips a detached middle pane with a draft task", () => {
    const hash = buildLawmindPopoutHash({
      kind: "workspace-pane",
      pane: "middle",
      title: "中栏",
      matterId: "m-1",
      draftTaskId: "d-1",
    });
    expect(parseLawmindPopoutRoute(`#${hash}`)).toEqual({
      kind: "workspace-pane",
      pane: "middle",
      title: "中栏",
      matterId: "m-1",
      draftTaskId: "d-1",
    });
  });

  it("rejects an unknown pane kind", () => {
    expect(parseLawmindPopoutRoute("#lm-popout=workspace-pane&pane=settings")).toBeNull();
    expect(parseLawmindPopoutRoute("#lm-popout=workspace-pane")).toBeNull();
  });

  it("does not let saved poll clobber fresh live editor values", () => {
    const now = 1_000_000;
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: null, now })).toBe(true);
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: now - 1_000, now })).toBe(false);
    expect(shouldApplySavedPreviewOverLive({ lastLiveAt: now - 20_000, now })).toBe(true);
  });
});
