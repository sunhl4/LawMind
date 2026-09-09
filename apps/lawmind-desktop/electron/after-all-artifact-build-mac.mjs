import { spawnSync } from "node:child_process";
import {
  hasNotaryCredentials,
  isDeveloperIdSigned,
  notarizeAndStapleArtifacts,
  resolvePackagedMacApp,
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

  const targetApp = resolvePackagedMacApp(buildResult.outDir, "LawMind");
  const signedDeveloperId = targetApp ? isDeveloperIdSigned(codesignDump(targetApp)) : false;

  if (!signedDeveloperId) {
    if (process.env.LAWMIND_REQUIRE_NOTARIZED === "1") {
      throw new Error(
        "LAWMIND_REQUIRE_NOTARIZED=1 but LawMind.app is not signed with Developer ID Application",
      );
    }
    console.warn(
      "[lawmind-mac] adhoc/unsigned build: Gatekeeper will block double-click after a browser download. Provide a Developer ID certificate to notarize.",
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
  console.log(`[lawmind-mac] notarized and stapled ${result.stapled.length} artifact(s)`);
}
