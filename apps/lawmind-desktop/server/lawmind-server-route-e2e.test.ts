import { afterEach, describe, expect, it } from "vitest";
import { areE2eTestRoutesEnabled } from "./lawmind-server-route-e2e.js";

describe("areE2eTestRoutesEnabled", () => {
  const prevEnable = process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES;
  const prevPackaged = process.env.LAWMIND_PACKAGED;

  afterEach(() => {
    if (prevEnable === undefined) {
      delete process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES;
    } else {
      process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES = prevEnable;
    }
    if (prevPackaged === undefined) {
      delete process.env.LAWMIND_PACKAGED;
    } else {
      process.env.LAWMIND_PACKAGED = prevPackaged;
    }
  });

  it("is false in packaged runtime even when the env flag is set", () => {
    process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES = "1";
    process.env.LAWMIND_PACKAGED = "1";
    expect(areE2eTestRoutesEnabled()).toBe(false);
  });

  it("is true only for unpackaged processes with the env flag", () => {
    process.env.LAWMIND_ENABLE_E2E_TEST_ROUTES = "1";
    delete process.env.LAWMIND_PACKAGED;
    expect(areE2eTestRoutesEnabled()).toBe(true);
  });
});
