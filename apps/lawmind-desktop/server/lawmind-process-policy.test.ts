import { afterEach, describe, expect, it } from "vitest";
import {
  getProcessHealthSignals,
  noteUncaughtException,
  noteUnhandledRejection,
  resetProcessHealthSignalsForTests,
} from "./lawmind-process-policy.js";

afterEach(() => {
  resetProcessHealthSignalsForTests();
});

describe("lawmind-process-policy health signals", () => {
  it("starts clean and not degraded", () => {
    expect(getProcessHealthSignals()).toEqual({
      uncaughtExceptions: 0,
      unhandledRejections: 0,
      degraded: false,
    });
  });

  it("counts unhandled rejections and degrades", () => {
    noteUnhandledRejection();
    noteUnhandledRejection();
    const signals = getProcessHealthSignals();
    expect(signals.unhandledRejections).toBe(2);
    expect(signals.uncaughtExceptions).toBe(0);
    expect(signals.degraded).toBe(true);
  });

  it("counts uncaught exceptions (recorded before clean exit) and degrades", () => {
    noteUncaughtException();
    const signals = getProcessHealthSignals();
    expect(signals.uncaughtExceptions).toBe(1);
    expect(signals.degraded).toBe(true);
  });

  it("resets for tests", () => {
    noteUnhandledRejection();
    resetProcessHealthSignalsForTests();
    expect(getProcessHealthSignals().degraded).toBe(false);
  });
});
