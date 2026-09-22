import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatReleaseArtifactsReport, inspectReleaseArtifacts } from "./release-artifacts.js";

describe("release-artifacts (signing / notarization / updater manifest)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-release-artifacts-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports honestly when there is no release directory at all", () => {
    const report = inspectReleaseArtifacts(path.join(dir, "missing"));
    expect(report.macSigning.status).toBe("not_evaluated");
    expect(report.updaterManifest.present).toBe(false);
    const { lines, risks } = formatReleaseArtifactsReport(report);
    expect(lines.some((l) => l.includes("未找到"))).toBe(true);
    expect(risks.some((r) => r.includes("签名/公证未评估"))).toBe(true);
  });

  it("flags a release dir without .app as signing not evaluated and lists installers", () => {
    fs.writeFileSync(path.join(dir, "LawMind-0.2.1-mac-arm64.dmg"), "x");
    fs.writeFileSync(path.join(dir, "latest-mac.yml"), "version: 0.2.1\n");
    const report = inspectReleaseArtifacts(dir);
    expect(report.installers).toContain("LawMind-0.2.1-mac-arm64.dmg");
    expect(report.updaterManifest.present).toBe(true);
    expect(report.updaterManifest.files).toEqual(["latest-mac.yml"]);
    expect(report.macSigning.status).toBe("not_evaluated");
  });

  it("treats a missing latest*.yml as a release risk, not a silent gap", () => {
    fs.writeFileSync(path.join(dir, "LawMind-0.2.1-mac-arm64.dmg"), "x");
    const report = inspectReleaseArtifacts(dir);
    expect(report.updaterManifest.present).toBe(false);
    const { risks } = formatReleaseArtifactsReport(report);
    expect(risks.some((r) => r.includes("latest*.yml"))).toBe(true);
  });

  it("collects installers across platforms and sorts them", () => {
    for (const name of [
      "LawMind-0.2.1-win-x64.exe",
      "LawMind-0.2.1-linux-x86_64.AppImage",
      "LawMind-0.2.1-mac-arm64.dmg",
      "builder-debug.yml",
    ]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    const report = inspectReleaseArtifacts(dir);
    expect(report.installers).toEqual([
      "LawMind-0.2.1-linux-x86_64.AppImage",
      "LawMind-0.2.1-mac-arm64.dmg",
      "LawMind-0.2.1-win-x64.exe",
    ]);
  });
});
