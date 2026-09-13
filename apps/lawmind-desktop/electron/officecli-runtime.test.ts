import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  applyOfficeCliEnv,
  bundledOfficeCliFileName,
  resolveOfficeCliExecutable,
} from "./officecli-runtime.mjs";

describe("officecli-runtime", () => {
  it("resolves packaged extraResources before the repo vendor copy", () => {
    const bundled = "/App/Contents/Resources/officecli/darwin-arm64/officecli";
    const vendored = "/repo/apps/lawmind-desktop/resources/officecli/darwin-arm64/officecli";
    expect(
      resolveOfficeCliExecutable({
        env: {},
        platform: "darwin",
        arch: "arm64",
        packaged: true,
        resourcesPath: "/App/Contents/Resources",
        repoRoot: "/repo",
        exists: (p) => p === bundled || p === vendored,
      }),
    ).toBe(bundled);
  });

  it("resolves the repo vendor path in unpackaged dev", () => {
    const vendored = path.join(
      "/repo",
      "apps/lawmind-desktop/resources/officecli/win32-x64/officecli.exe",
    );
    expect(bundledOfficeCliFileName("win32")).toBe("officecli.exe");
    expect(
      resolveOfficeCliExecutable({
        env: {},
        platform: "win32",
        arch: "x64",
        packaged: false,
        repoRoot: "/repo",
        exists: (p) => p === vendored,
      }),
    ).toBe(vendored);
  });

  it("lets LAWMIND_OFFICECLI override layout", () => {
    const override = "/custom/officecli";
    expect(
      resolveOfficeCliExecutable({
        env: { LAWMIND_OFFICECLI: override },
        packaged: true,
        resourcesPath: "/App/Resources",
        exists: (p) => p === override,
      }),
    ).toBe(override);
  });

  it("prepends the binary dir to PATH", () => {
    const bin = "/App/Resources/officecli/darwin-arm64/officecli";
    const env = applyOfficeCliEnv({ PATH: "/usr/bin", HOME: "/Users/a" }, bin);
    expect(env.LAWMIND_OFFICECLI).toBe(bin);
    expect(env.PATH.startsWith(`${path.dirname(bin)}${path.delimiter}`)).toBe(true);
  });
});
