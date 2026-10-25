import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  hasNotaryCredentials,
  isDeveloperIdSigned,
  listPackagedMacApps,
  notarizeAndStapleArtifacts,
} from "./mac-gatekeeper.mjs";

function codesignDump(targetPath) {
  const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", targetPath], {
    encoding: "utf8",
  });
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

export default async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== "darwin") {
    return;
  }

  // 一次构建可能出多个 .app（mac-arm64 + mac，x64 的 appOutDir 就叫 mac）。必须**每一个**都检查：
  // 只看第一个（旧实现固定取 mac-arm64）会让 Intel 包没签名也能发出去。
  const apps = listPackagedMacApps(buildResult.outDir, "LawMind");
  const unsigned = apps.filter((app) => !isDeveloperIdSigned(codesignDump(app)));
  const relative = unsigned.map((app) => path.basename(path.dirname(app)));

  if (unsigned.length > 0) {
    if (process.env.LAWMIND_REQUIRE_NOTARIZED === "1") {
      throw new Error(
        `LAWMIND_REQUIRE_NOTARIZED=1 but these LawMind.app builds are not signed with Developer ID Application: ${relative.join(", ")}`,
      );
    }
    console.warn(
      `[lawmind-mac] adhoc/unsigned build (${relative.join(", ")}): Gatekeeper will block double-click after a browser download. Provide a Developer ID certificate to notarize.`,
    );
    return;
  }

  if (!hasNotaryCredentials(process.env)) {
    if (process.env.LAWMIND_REQUIRE_NOTARIZED === "1") {
      throw new Error("LAWMIND_REQUIRE_NOTARIZED=1 but Apple notary credentials are not set");
    }
    console.warn(
      "[lawmind-mac] Developer ID signature present, but notary credentials are missing; skip notarization.",
    );
    return;
  }

  const result = notarizeAndStapleArtifacts(buildResult.artifactPaths ?? []);
  const unstapleable = result.unstapleable.length
    ? `, not stapleable: ${result.unstapleable.map((file) => path.basename(file)).join(", ")}`
    : "";
  console.log(
    `[lawmind-mac] signed ${apps.length} app(s); notarized ${result.notarized.length}, stapled ${result.stapled.length}${unstapleable}`,
  );
}
