import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyMacElectronAppBrand,
  computeStamp,
  isStampCurrent,
  replacePlistString,
  syncSvgCopies,
} from "../../../scripts/lawmind/apply-desktop-brand.mjs";

function minimalPlist(name: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>${name}</string>
  <key>CFBundleName</key>
  <string>${name}</string>
</dict>
</plist>
`;
}

describe("apply-desktop-brand", () => {
  it("replaces plist string keys", () => {
    const next = replacePlistString(minimalPlist("Electron"), "CFBundleDisplayName", "LawMind");
    expect(next).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>LawMind<\/string>/);
    expect(next).toMatch(/<key>CFBundleName<\/key>\s*<string>Electron<\/string>/);
  });

  it("stamps and patches a fake Electron.app", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-brand-"));
    const appPath = path.join(tmp, "Electron.app");
    fs.mkdirSync(path.join(appPath, "Contents", "Resources"), { recursive: true });
    fs.mkdirSync(path.join(appPath, "Contents", "Frameworks", "Electron Helper.app", "Contents"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), minimalPlist("Electron"));
    fs.writeFileSync(
      path.join(appPath, "Contents", "Frameworks", "Electron Helper.app", "Contents", "Info.plist"),
      minimalPlist("Electron Helper"),
    );
    const icnsPath = path.join(tmp, "icon.icns");
    fs.writeFileSync(icnsPath, "icns");
    const pngPath = path.join(tmp, "icon.png");
    fs.writeFileSync(pngPath, "png");
    const stamp = computeStamp({ productName: "LawMind" }, pngPath);
    expect(isStampCurrent(appPath, stamp)).toBe(false);
    applyMacElectronAppBrand({
      appPath,
      icnsPath,
      productName: "LawMind",
      stamp,
    });
    expect(fs.readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8")).toContain(
      "LawMind",
    );
    expect(
      fs.readFileSync(
        path.join(appPath, "Contents", "Frameworks", "Electron Helper.app", "Contents", "Info.plist"),
        "utf8",
      ),
    ).toContain("LawMind Helper");
    expect(fs.readFileSync(path.join(appPath, "Contents", "Resources", "electron.icns"), "utf8")).toBe(
      "icns",
    );
    expect(isStampCurrent(appPath, stamp)).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("syncs SVG copies from the manifest source", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-svg-"));
    const srcRel = "src/renderer/assets/lawmind-mark.svg";
    fs.mkdirSync(path.join(tmp, path.dirname(srcRel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, srcRel), "<svg id='mark'/>");
    const copied = syncSvgCopies(
      {
        productName: "LawMind",
        icons: { svg: srcRel },
        svgCopies: ["src/renderer/public/favicon.svg", "build/icon.svg"],
      },
      tmp,
    );
    expect(copied).toHaveLength(2);
    expect(fs.readFileSync(path.join(tmp, "src/renderer/public/favicon.svg"), "utf8")).toContain("mark");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
