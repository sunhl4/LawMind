import { describe, expect, it } from "vitest";
import { combineAbortSignals, ModelCallUserAbortError } from "./runtime-model-call.js";

describe("combineAbortSignals", () => {
  it("wasUserAbort becomes true when external signal aborts", async () => {
    const external = new AbortController();
    const combined = combineAbortSignals(60_000, external.signal);
    expect(combined.wasUserAbort()).toBe(false);
    external.abort();
    expect(combined.signal.aborted).toBe(true);
    expect(combined.wasUserAbort()).toBe(true);
    combined.cleanup();
  });

  it("timeoutMs 0 does not auto-abort without external signal", async () => {
    const combined = combineAbortSignals(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(combined.signal.aborted).toBe(false);
    combined.cleanup();
  });

  it("ModelCallUserAbortError has stable name", () => {
    const err = new ModelCallUserAbortError();
    expect(err.name).toBe("ModelCallUserAbortError");
    expect(err.message).toMatch(/cancelled|stop/i);
  });
});
