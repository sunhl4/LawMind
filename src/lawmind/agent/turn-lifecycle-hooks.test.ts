import { afterEach, describe, expect, it } from "vitest";
import {
  clearTurnLifecycleHooks,
  emitTurnLifecycle,
  registerTurnLifecycleHook,
  type TurnLifecycleEvent,
} from "./turn-lifecycle-hooks.js";

describe("turn-lifecycle-hooks", () => {
  afterEach(() => {
    clearTurnLifecycleHooks();
  });

  it("delivers events to registered hooks and ignores hook throws", () => {
    const seen: TurnLifecycleEvent[] = [];
    registerTurnLifecycleHook(() => {
      throw new Error("hook boom");
    });
    registerTurnLifecycleHook((ev) => {
      seen.push(ev);
    });
    emitTurnLifecycle({
      phase: "model_error",
      sessionId: "s1",
      detail: { message: "timeout" },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.phase).toBe("model_error");
  });

  it("unsubscribe stops delivery", () => {
    const seen: string[] = [];
    const off = registerTurnLifecycleHook((ev) => {
      seen.push(ev.phase);
    });
    off();
    emitTurnLifecycle({ phase: "after_compact", sessionId: "s1" });
    expect(seen).toEqual([]);
  });
});
