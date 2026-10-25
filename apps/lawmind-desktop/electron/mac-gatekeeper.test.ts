import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCodesignArgs,
  buildNotarytoolSubmitArgs,
  collectNotarizeArtifacts,
  collectStapleArtifacts,
  hasNotaryCredentials,
  isStapleableArtifact,
  notarizeAndStapleArtifacts,
  listPackagedMacApps,
  resolvePackagedMacApp,
  isDeveloperIdSigned,
  listBundledNodeBinaries,
  listBundledOfficeCliBinaries,
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

describe("staple targets", () => {
  it("accepts only what stapler supports (app / dmg / pkg)", () => {
    expect(isStapleableArtifact("/out/LawMind-0.2.2-mac-arm64.dmg")).toBe(true);
    expect(isStapleableArtifact("/out/LawMind-0.2.2-mac-x64.pkg")).toBe(true);
    expect(isStapleableArtifact("/out/mac-arm64/LawMind.app")).toBe(true);
    expect(isStapleableArtifact("/out/LawMind-0.2.2-mac-arm64.zip")).toBe(false);
    expect(isStapleableArtifact("/out/LawMind-0.2.2-mac-arm64.ZIP")).toBe(false);
    expect(isStapleableArtifact("")).toBe(false);
    expect(isStapleableArtifact(undefined)).toBe(false);
  });

  it("collectStapleArtifacts drops the zip but keeps the dmg", () => {
    expect(
      collectStapleArtifacts([
        "/out/LawMind-0.2.2-mac-arm64.dmg",
        "/out/LawMind-0.2.2-mac-arm64.zip",
        "/out/latest-mac.yml",
      ]),
    ).toEqual(["/out/LawMind-0.2.2-mac-arm64.dmg"]);
  });
});

describe("notarizeAndStapleArtifacts", () => {
  const dmg = "/out/LawMind-0.2.2-mac-arm64.dmg";
  const zip = "/out/LawMind-0.2.2-mac-arm64.zip";
  const credentials = {
    APPLE_ID: "a@b.c",
    APPLE_APP_SPECIFIC_PASSWORD: "xxxx-xxxx-xxxx-xxxx",
    APPLE_TEAM_ID: "TEAM123",
  };

  it("submits dmg + zip but only staples the dmg", () => {
    const calls: string[][] = [];
    const warnings: string[] = [];
    const result = notarizeAndStapleArtifacts([dmg, zip], {
      env: credentials,
      execFile: (_cmd: string, args: string[]) => {
        calls.push(args);
        return "";
      },
      log: { warn: (message: string) => warnings.push(message) },
    });

    expect(result.notarized).toEqual([dmg, zip]);
    expect(result.stapled).toEqual([dmg]);
    expect(result.unstapleable).toEqual([zip]);
    // submit dmg → staple dmg → submit zip → (no staple for zip)
    expect(calls.map((args) => args.slice(0, 2))).toEqual([
      ["notarytool", "submit"],
      ["stapler", "staple"],
      ["notarytool", "submit"],
    ]);
    expect(calls[1]).toEqual(["stapler", "staple", dmg]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("not stapled");
    expect(warnings[0]).toContain("LawMind-0.2.2-mac-arm64.zip");
  });

  it("does not call xcrun when credentials are absent", () => {
    let called = 0;
    const result = notarizeAndStapleArtifacts([dmg, zip], {
      env: {},
      execFile: () => {
        called += 1;
        return "";
      },
    });

    expect(called).toBe(0);
    expect(result).toEqual({
      skipped: "no-notary-credentials",
      notarized: [],
      stapled: [],
      unstapleable: [],
    });
  });

  it("throws when notarized builds are required but credentials are missing", () => {
    expect(() =>
      notarizeAndStapleArtifacts([dmg], {
        env: { LAWMIND_REQUIRE_NOTARIZED: "1" },
        execFile: () => "",
      }),
    ).toThrow(/Apple notary credentials are not set/);
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

  it("lists every packaged arch so both get signature-checked", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-out-both-"));
    const arm = path.join(root, "mac-arm64", "LawMind.app");
    const intel = path.join(root, "mac", "LawMind.app"); // electron-builder: x64 的 appOutDir 是裸 mac
    fs.mkdirSync(arm, { recursive: true });
    fs.mkdirSync(intel, { recursive: true });
    expect(listPackagedMacApps(root).toSorted((a, b) => a.localeCompare(b))).toEqual(
      [arm, intel].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(resolvePackagedMacApp(root, "LawMind", "x64")).toBe(intel);
    expect(resolvePackagedMacApp(root, "LawMind", "arm64")).toBe(arm);
    // 未知架构回退到任意一个已存在的包，而不是返回空串。
    expect(resolvePackagedMacApp(root, "LawMind", "ia32")).toBe(arm);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("still finds an app under a legacy mac-x64 directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-out-legacy-"));
    const intel = path.join(root, "mac-x64", "LawMind.app");
    fs.mkdirSync(intel, { recursive: true });
    expect(resolvePackagedMacApp(root, "LawMind", "x64")).toBe(intel);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns an empty result when nothing was packaged", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-out-empty-"));
    expect(listPackagedMacApps(root)).toEqual([]);
    expect(resolvePackagedMacApp(root)).toBe("");
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

describe("listBundledOfficeCliBinaries", () => {
  it("finds unix and windows officecli binaries under officecli", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-app-oc-"));
    const app = path.join(root, "LawMind.app");
    const unix = path.join(app, "Contents/Resources/officecli/darwin-arm64/officecli");
    const win = path.join(app, "Contents/Resources/officecli/win32-x64/officecli.exe");
    fs.mkdirSync(path.dirname(unix), { recursive: true });
    fs.mkdirSync(path.dirname(win), { recursive: true });
    fs.writeFileSync(unix, "");
    fs.writeFileSync(win, "");
    fs.writeFileSync(path.join(path.dirname(unix), "NOTICE"), "");
    expect(listBundledOfficeCliBinaries(app)).toEqual([unix, win].toSorted((a, b) => a.localeCompare(b)));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("signLawMindMacApp", () => {
  it("signs nested node and officecli then the app when using adhoc", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sign-"));
    const app = path.join(root, "LawMind.app");
    const nodeBin = path.join(app, "Contents/Resources/node-runtime/darwin-arm64/bin/node");
    const officeBin = path.join(app, "Contents/Resources/officecli/darwin-arm64/officecli");
    fs.mkdirSync(path.dirname(nodeBin), { recursive: true });
    fs.mkdirSync(path.dirname(officeBin), { recursive: true });
    fs.writeFileSync(nodeBin, "");
    fs.writeFileSync(officeBin, "");
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
    expect(calls).toHaveLength(3);
    const lastArgs = calls.slice(0, 2).map((c) => c.at(-1));
    expect(lastArgs.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [nodeBin, officeBin].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(calls[2]?.includes("--deep")).toBe(true);
    expect(calls[2]?.at(-1)).toBe(app);
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
