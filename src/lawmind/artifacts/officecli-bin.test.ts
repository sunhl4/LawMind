import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledOfficeCliFileName,
  officecliRuntimeKey,
  resolveOfficeCliBin,
} from "./officecli-bin.js";

describe("officecli-bin", () => {
  it("names the windows binary with .exe", () => {
    expect(bundledOfficeCliFileName("win32")).toBe("officecli.exe");
    expect(bundledOfficeCliFileName("darwin")).toBe("officecli");
    expect(officecliRuntimeKey("darwin", "arm64")).toBe("darwin-arm64");
  });

  it("prefers an explicit path over env and vendor layout", () => {
    const explicit = "/tmp/lm-explicit/officecli";
    const envBin = "/tmp/lm-env/officecli";
    expect(
      resolveOfficeCliBin({
        explicit,
        env: { LAWMIND_OFFICECLI: envBin },
        exists: (p) => p === explicit || p === envBin,
      }),
    ).toBe(explicit);
  });

  it("uses LAWMIND_OFFICECLI when the file exists", () => {
    const envBin = "/opt/lawmind/officecli";
    expect(
      resolveOfficeCliBin({
        env: { LAWMIND_OFFICECLI: envBin },
        exists: (p) => p === envBin,
      }),
    ).toBe(envBin);
  });

  it("resolves extraResources layout from LAWMIND_RESOURCES_PATH", () => {
    const resources = "/App/Contents/Resources";
    const expected = path.join(resources, "officecli", "darwin-arm64", "officecli");
    expect(
      resolveOfficeCliBin({
        env: { LAWMIND_RESOURCES_PATH: resources },
        platform: "darwin",
        arch: "arm64",
        exists: (p) => p === expected,
      }),
    ).toBe(expected);
  });

  it("resolves the repo vendor layout from LAWMIND_REPO_ROOT", () => {
    const root = "/src/LawMind";
    const expected = path.join(
      root,
      "apps/lawmind-desktop/resources/officecli/linux-x64/officecli",
    );
    expect(
      resolveOfficeCliBin({
        env: { LAWMIND_REPO_ROOT: root },
        platform: "linux",
        arch: "x64",
        exists: (p) => p === expected,
      }),
    ).toBe(expected);
  });

  it("returns undefined when nothing is vendored", () => {
    expect(
      resolveOfficeCliBin({
        env: {},
        cwd: "/tmp/empty-cwd",
        exists: () => false,
      }),
    ).toBeUndefined();
  });
});
