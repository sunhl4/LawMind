import { describe, expect, it, beforeEach } from "vitest";
import {
  bindTurnAbortSignal,
  clearTurnAbort,
  isTurnAbortRequested,
  requestTurnAbort,
  resetTurnAbortStore,
} from "./turn-abort.js";

describe("turn-abort", () => {
  beforeEach(() => {
    resetTurnAbortStore();
  });

  it("tracks abort requests per session", () => {
    expect(isTurnAbortRequested("s1")).toBe(false);
    requestTurnAbort("s1");
    expect(isTurnAbortRequested("s1")).toBe(true);
    expect(isTurnAbortRequested("s2")).toBe(false);
    clearTurnAbort("s1");
    expect(isTurnAbortRequested("s1")).toBe(false);
  });

  it("aborts the bound signal when Stop is requested", () => {
    const signal = bindTurnAbortSignal("s-live");
    expect(signal.aborted).toBe(false);
    requestTurnAbort("s-live");
    expect(signal.aborted).toBe(true);
    expect(isTurnAbortRequested("s-live")).toBe(true);
  });
});
