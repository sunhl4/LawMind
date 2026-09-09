/**
 * macOS Gatekeeper helpers for LawMind.app.
 *
 * Browser-downloaded apps only double-click when signed with
 * Developer ID Application and notarized. Adhoc (`-`) seals resources so a
 * locally built app launches; it does not pass Gatekeeper after download.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IDENTITY_LINE = /^\s*\d+\)\s+([0-9A-F]+)\s+"([^"]+)"/gm;

export function parseCodesignIdentities(raw) {
  const text = typeof raw === "string" ? raw : "";
  const out = [];
  IDENTITY_LINE.lastIndex = 0;
  let match = IDENTITY_LINE.exec(text);
  while (match) {
    out.push({ hash: match[1], name: match[2] });
    match = IDENTITY_LINE.exec(text);
  }
  return out;
}

export function pickMacSignIdentity({ env = process.env, identities = [] } = {}) {
  const explicit = String(env.CSC_NAME || env.LAWMIND_MAC_SIGN_IDENTITY || "").trim();
  if (explicit) {
    return {
      identity: explicit,
      source: "env",
      kind: explicit === "-" ? "adhoc" : "named",
    };
  }

  const developerId = identities.find((item) => /Developer ID Application/i.test(item.name));
  if (developerId) {
    return {
      identity: developerId.hash || developerId.name,
      source: "keychain",
      kind: "developer-id",
    };
  }

  if (env.LAWMIND_REQUIRE_NOTARIZED === "1") {
    throw new Error(
      "LAWMIND_REQUIRE_NOTARIZED=1 but no Developer ID Application identity was found. Install a Developer ID certificate or set CSC_NAME / CSC_LINK.",
    );
  }

  return { identity: "-", source: "adhoc", kind: "adhoc" };
}

export function hasNotaryCredentials(env = process.env) {
  if (String(env.APPLE_KEYCHAIN_PROFILE || "").trim()) {
    return true;
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return true;
  }
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return true;
  }
  return false;
}

export function isDeveloperIdSigned(codesignVerboseText) {
  const text = typeof codesignVerboseText === "string" ? codesignVerboseText : "";
  return /Authority=Developer ID Application/i.test(text) && /TeamIdentifier=[A-Z0-9]+/.test(text);
}

export function listBundledNodeBinaries(appPath) {
  const root = path.join(appPath, "Contents", "Resources", "node-runtime");
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(next);
        continue;
      }
      if (entry.name === "node" || entry.name === "node.exe") {
        out.push(next);
      }
    }
  };
  walk(root);
  return out.toSorted((a, b) => a.localeCompare(b));
}

export function buildCodesignArgs({ identity, entitlements, file, deep = false }) {
  const args = ["--sign", identity, "--force", "--options", "runtime"];
  if (identity !== "-") {
    args.push("--timestamp");
  }
  if (deep) {
    args.push("--deep");
  }
  if (entitlements) {
    args.push("--entitlements", entitlements);
  }
  args.push(file);
  return args;
}

export function buildNotarytoolSubmitArgs({ file, env = process.env }) {
  const profile = String(env.APPLE_KEYCHAIN_PROFILE || "").trim();
  if (profile) {
    const args = ["notarytool", "submit", file, "--keychain-profile", profile, "--wait"];
    const keychain = String(env.APPLE_KEYCHAIN || "").trim();
    if (keychain) {
      args.push("--keychain", keychain);
    }
    return args;
  }
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return [
      "notarytool",
      "submit",
      file,
      "--key",
      env.APPLE_API_KEY,
      "--key-id",
      env.APPLE_API_KEY_ID,
      "--issuer",
      env.APPLE_API_ISSUER,
      "--wait",
    ];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return [
      "notarytool",
      "submit",
      file,
      "--apple-id",
      env.APPLE_ID,
      "--password",
      env.APPLE_APP_SPECIFIC_PASSWORD,
      "--team-id",
      env.APPLE_TEAM_ID,
      "--wait",
    ];
  }
  throw new Error("missing Apple notary credentials");
}

function defaultExecFile(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function readCodesignIdentities(execFile = defaultExecFile) {
  try {
    const raw = execFile("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
    });
    return parseCodesignIdentities(typeof raw === "string" ? raw : raw?.stdout ?? "");
  } catch {
    return [];
  }
}

export function readCodesignVerbose(targetPath, execFile = defaultExecFile) {
  try {
    execFile("/usr/bin/codesign", ["-dv", "--verbose=2", targetPath], { encoding: "utf8" });
    return "";
  } catch (error) {
    // codesign -dv writes to stderr and exits 0; some wrappers surface stderr on throw.
    const err = error && typeof error === "object" ? error : {};
    return String(err.stderr || err.stdout || err.message || "");
  }
}

/**
 * Sign bundled node first, then the .app when electron-builder will skip
 * Developer ID signing (adhoc / named fallback).
 */
export function signLawMindMacApp(appPath, options = {}) {
  const {
    env = process.env,
    identities,
    entitlements,
    entitlementsInherit,
    execFile = defaultExecFile,
  } = options;

  if (!appPath || !fs.existsSync(appPath)) {
    throw new Error(`LawMind.app not found: ${appPath || "(empty path)"}`);
  }

  const picked = pickMacSignIdentity({
    env,
    identities: identities ?? readCodesignIdentities(execFile),
  });
  const nodeBins = listBundledNodeBinaries(appPath);
  const inherit = entitlementsInherit || entitlements;
  const signed = [];

  for (const file of nodeBins) {
    execFile("/usr/bin/codesign", buildCodesignArgs({ identity: picked.identity, entitlements: inherit, file }));
    signed.push(file);
  }

  execFile(
    "/usr/bin/codesign",
    buildCodesignArgs({
      identity: picked.identity,
      entitlements,
      file: appPath,
      deep: true,
    }),
  );

  return { picked, signedNodes: signed, appPath };
}

export function resolvePackagedMacApp(outDir, productFilename = "LawMind") {
  const name = `${productFilename}.app`;
  const candidates = ["mac-arm64", "mac", "mac-universal", "mac-x64"].map((dir) =>
    path.join(outDir, dir, name),
  );
  return candidates.find((file) => fs.existsSync(file)) ?? "";
}

export function collectNotarizeArtifacts(artifactPaths) {
  return (artifactPaths ?? []).filter(
    (file) => typeof file === "string" && (file.endsWith(".dmg") || file.endsWith(".zip")),
  );
}

export function notarizeAndStapleArtifacts(artifactPaths, options = {}) {
  const { env = process.env, execFile = defaultExecFile } = options;
  if (!hasNotaryCredentials(env)) {
    if (env.LAWMIND_REQUIRE_NOTARIZED === "1") {
      throw new Error("LAWMIND_REQUIRE_NOTARIZED=1 but Apple notary credentials are not set");
    }
    return { skipped: "no-notary-credentials", stapled: [] };
  }

  const files = collectNotarizeArtifacts(artifactPaths);
  const stapled = [];
  for (const file of files) {
    execFile("/usr/bin/xcrun", buildNotarytoolSubmitArgs({ file, env }), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFile("/usr/bin/xcrun", ["stapler", "staple", file], { encoding: "utf8" });
    stapled.push(file);
  }
  return { skipped: "", stapled };
}

function isDirectRun(href) {
  const entry = process.argv[1];
  return Boolean(entry) && href === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const appFlag = args.indexOf("--app");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appPath =
    appFlag >= 0
      ? path.resolve(args[appFlag + 1] ?? "")
      : path.resolve(here, "../release/mac-arm64/LawMind.app");
  const entitlements = path.join(here, "entitlements.mac.plist");
  const entitlementsInherit = path.join(here, "entitlements.mac.inherit.plist");
  const result = signLawMindMacApp(appPath, { entitlements, entitlementsInherit });
  process.stdout.write(
    `signed ${result.appPath}\nidentity=${result.picked.identity} kind=${result.picked.kind} nodes=${result.signedNodes.length}\n`,
  );
}
