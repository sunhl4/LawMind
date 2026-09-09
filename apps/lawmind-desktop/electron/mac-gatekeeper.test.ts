import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCodesignArgs,
  buildNotarytoolSubmitArgs,
  collectNotarizeArtifacts,
  hasNotaryCredentials,
  resolvePackagedMacApp,
  isDeveloperIdSigned,
  listBundledNodeBinaries,
  parseCodesignIdentities,
  pickMacSignIdentity,
  signLawMindMacApp,
} from "./mac-gatekeeper.mjs";

describe("parseCodesignIdentities", () => {
  it("reads hash and quoted name lines", () => {
    const raw = `
     1) AABBCC0011 "Developer ID Application: LawMind Ltd (TEAM123)"
     2) DDEEFF2233 "Apple Development: someone@example.com (ABC)"
     0 valid identities found
`;
    expect(parseCodesignIdentities(raw)).toEqual([
      { hash: "AABBCC0011", name: "Developer ID Application: LawMind Ltd (TEAM123)" },
      { hash: "DDEEFF2233", name: "Apple Development: someone@example.com (ABC)" },
    ]);
  });
});

describe("pickMacSignIdentity", () => {
  const developerId = {
    hash: "AABBCC",
    name: "Developer ID Application: LawMind Ltd (TEAM123)",
  };

  it("prefers CSC_NAME over keychain", () => {
    expect(
      pickMacSignIdentity({
        env: { CSC_NAME: "Developer ID Application: Override" },
        identities: [developerId],
      }),
    ).toEqual({
      identity: "Developer ID Application: Override",
      source: "env",
      kind: "named",
    });
  });

  it("uses Developer ID from the keychain", () => {
    expect(pickMacSignIdentity({ env: {}, identities: [developerId] })).toEqual({
      identity: "AABBCC",
      source: "keychain",
      kind: "developer-id",
    });
  });

  it("falls back to adhoc when no certificate exists", () => {
    expect(pickMacSignIdentity({ env: {}, identities: [] })).toEqual({
      identity: "-",
      source: "adhoc",
      kind: "adhoc",
    });
  });

  it("refuses adhoc when notarized builds are required", () => {
    expect(() =>
      pickMacSignIdentity({ env: { LAWMIND_REQUIRE_NOTARIZED: "1" }, identities: [] }),
    ).toThrow(/Developer ID Application/);
  });
});

describe("buildCodesignArgs", () => {
  it("omits Apple timestamp for adhoc identities", () => {
    expect(
      buildCodesignArgs({
        identity: "-",
        entitlements: "/tmp/e.plist",
        file: "/tmp/LawMind.app",
        deep: true,
      }),
    ).toEqual([
      "--sign",
      "-",
      "--force",
      "--options",
      "runtime",
      "--deep",
      "--entitlements",
      "/tmp/e.plist",
      "/tmp/LawMind.app",
    ]);
  });
});

describe("notary helpers", () => {
  it("detects the three Apple credential styles", () => {
    expect(hasNotaryCredentials({})).toBe(false);
    expect(hasNotaryCredentials({ APPLE_KEYCHAIN_PROFILE: "lawmind" })).toBe(true);
    expect(
      hasNotaryCredentials({
        APPLE_ID: "a@b.c",
        APPLE_APP_SPECIFIC_PASSWORD: "xxxx",
        APPLE_TEAM_ID: "TEAM123",
      }),
    ).toBe(true);
    expect(
      hasNotaryCredentials({
        APPLE_API_KEY: "/tmp/key.p8",
        APPLE_API_KEY_ID: "KEYID",
        APPLE_API_ISSUER: "issuer-uuid",
      }),
    ).toBe(true);
  });

  it("builds notarytool args without inventing credentials", () => {
    expect(
      buildNotarytoolSubmitArgs({
        file: "/tmp/LawMind.dmg",
        env: { APPLE_KEYCHAIN_PROFILE: "lawmind" },
      }),
    ).toEqual(["notarytool", "submit", "/tmp/LawMind.dmg", "--keychain-profile", "lawmind", "--wait"]);
  });

  it("keeps dmg and zip artifacts only", () => {
    expect(
      collectNotarizeArtifacts([
        "/out/LawMind-0.1.0-mac-arm64.dmg",
        "/out/LawMind-0.1.0-mac-arm64.zip",
        "/out/latest-mac.yml",
        "/out/LawMind-0.1.0-mac-arm64.dmg.blockmap",
      ]),
    ).toEqual(["/out/LawMind-0.1.0-mac-arm64.dmg", "/out/LawMind-0.1.0-mac-arm64.zip"]);
  });

  it("recognizes a Developer ID codesign dump", () => {
    expect(
      isDeveloperIdSigned(
        "Authority=Developer ID Application: LawMind Ltd (TEAM123)\nTeamIdentifier=TEAM123\n",
      ),
    ).toBe(true);
    expect(isDeveloperIdSigned("Signature=adhoc\nTeamIdentifier=not set\n")).toBe(false);
  });
});

describe("resolvePackagedMacApp", () => {
  it("prefers the arm64 pack directory when present", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-out-"));
    const app = path.join(root, "mac-arm64", "LawMind.app");
    fs.mkdirSync(app, { recursive: true });
    expect(resolvePackagedMacApp(root)).toBe(app);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("listBundledNodeBinaries", () => {
  it("finds unix and windows node binaries under node-runtime", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-app-"));
    const app = path.join(root, "LawMind.app");
    const unix = path.join(app, "Contents/Resources/node-runtime/darwin-arm64/bin/node");
    const win = path.join(app, "Contents/Resources/node-runtime/win32-x64/node.exe");
    fs.mkdirSync(path.dirname(unix), { recursive: true });
    fs.mkdirSync(path.dirname(win), { recursive: true });
    fs.writeFileSync(unix, "");
    fs.writeFileSync(win, "");
    fs.writeFileSync(path.join(path.dirname(unix), "README"), "");
    expect(listBundledNodeBinaries(app)).toEqual([unix, win].toSorted((a, b) => a.localeCompare(b)));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("signLawMindMacApp", () => {
  it("signs nested node then the app when using adhoc", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sign-"));
    const app = path.join(root, "LawMind.app");
    const nodeBin = path.join(app, "Contents/Resources/node-runtime/darwin-arm64/bin/node");
    fs.mkdirSync(path.dirname(nodeBin), { recursive: true });
    fs.writeFileSync(nodeBin, "");
    const calls: string[][] = [];
    const result = signLawMindMacApp(app, {
      env: {},
      identities: [],
      entitlements: "/tmp/entitlements.mac.plist",
      execFile: (_cmd: string, args: string[]) => {
        calls.push(args);
        return "";
      },
    });
    expect(result.picked.kind).toBe("adhoc");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(
      buildCodesignArgs({
        identity: "-",
        entitlements: "/tmp/entitlements.mac.plist",
        file: nodeBin,
      }),
    );
    expect(calls[1]?.includes("--deep")).toBe(true);
    expect(calls[1]?.at(-1)).toBe(app);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("signs nested node and the app with Developer ID", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sign-id-"));
    const app = path.join(root, "LawMind.app");
    const nodeBin = path.join(app, "Contents/Resources/node-runtime/darwin-arm64/bin/node");
    fs.mkdirSync(path.dirname(nodeBin), { recursive: true });
    fs.writeFileSync(nodeBin, "");
    const calls: string[][] = [];
    signLawMindMacApp(app, {
      env: {},
      identities: [{ hash: "AABBCC", name: "Developer ID Application: LawMind Ltd (TEAM123)" }],
      entitlements: "/tmp/entitlements.mac.plist",
      execFile: (_cmd: string, args: string[]) => {
        calls.push(args);
        return "";
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.includes("--timestamp")).toBe(true);
    expect(calls[0]?.at(-1)).toBe(nodeBin);
    expect(calls[1]?.at(-1)).toBe(app);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
