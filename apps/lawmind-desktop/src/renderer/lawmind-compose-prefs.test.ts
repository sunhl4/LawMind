/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPostFirstrunPermissionDefaults,
  readComposePermissionMode,
  readExecutePermissionMode,
  writeComposePermissionMode,
  writeExecutePermissionMode,
} from "./lawmind-compose-prefs";

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

describe("lawmind-compose-prefs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults compose to standard and execute to standard", () => {
    expect(readComposePermissionMode()).toBe("standard");
    expect(readExecutePermissionMode()).toBe("standard");
  });

  it("post-firstrun seeds readonly compose and strict execute preference", () => {
    applyPostFirstrunPermissionDefaults();
    expect(readComposePermissionMode()).toBe("readonly");
    expect(readExecutePermissionMode()).toBe("strict");
  });

  it("post-firstrun executable path uses standard compose for contract Day-1", () => {
    applyPostFirstrunPermissionDefaults({ executable: true });
    expect(readComposePermissionMode()).toBe("standard");
    expect(readExecutePermissionMode()).toBe("strict");
  });

  it("restore-standard path can clear execute preference", () => {
    applyPostFirstrunPermissionDefaults();
    writeExecutePermissionMode("standard");
    writeComposePermissionMode("standard");
    expect(readComposePermissionMode()).toBe("standard");
    expect(readExecutePermissionMode()).toBe("standard");
  });
});
