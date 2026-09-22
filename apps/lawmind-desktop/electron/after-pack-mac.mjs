import path from "node:path";
import { fileURLToPath } from "node:url";
import { signLawMindMacApp } from "./mac-gatekeeper.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const result = signLawMindMacApp(appPath, {
    entitlements: path.join(here, "entitlements.mac.plist"),
    entitlementsInherit: path.join(here, "entitlements.mac.inherit.plist"),
  });
  console.log(
    `[lawmind-mac] ${result.picked.kind} sign: nodes=${result.signedNodes.length} identity=${result.picked.source}`,
  );
}
