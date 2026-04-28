import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY,
  readIncludeTurnDiagnostics,
  writeIncludeTurnDiagnostics,
} from "./lawmind-chat-diagnostics-pref.ts";

describe("lawmind-chat-diagnostics-pref", () => {
  const store: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("reads false when key missing", () => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    expect(readIncludeTurnDiagnostics()).toBe(false);
  });

  it("round-trips enabled flag", () => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
    writeIncludeTurnDiagnostics(true);
    expect(store[LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY]).toBe("1");
    expect(readIncludeTurnDiagnostics()).toBe(true);
    writeIncludeTurnDiagnostics(false);
    expect(store[LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY]).toBeUndefined();
    expect(readIncludeTurnDiagnostics()).toBe(false);
  });
});
