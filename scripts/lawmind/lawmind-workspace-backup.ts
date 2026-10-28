/**
 * Pack a LawMind workspace into a verifiable zip.
 *
 * Usage:
 *   pnpm lawmind:workspace:backup -- --workspace <dir> [--out <zip>] [--include-secrets] [--json]
 *
 * Secrets are excluded by default. Including them is an explicit, risky choice;
 * encrypt the archive before moving it off the machine.
 */

import path from "node:path";
import { createWorkspaceBackup } from "../../src/lawmind/platform/workspace-backup.js";

const argv = process.argv.slice(2);

function valueOf(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const workspaceDir = path.resolve(process.cwd(), valueOf("--workspace") ?? "workspace");
const outputPath = valueOf("--out");
const includeSecrets = argv.includes("--include-secrets");
const asJson = argv.includes("--json");

try {
  const result = await createWorkspaceBackup({
    workspaceDir,
    ...(outputPath ? { outputPath } : {}),
    includeSecrets,
  });
  if (asJson) {
    console.log(JSON.stringify(result.manifest, null, 2));
  } else {
    console.log(`Wrote ${result.outputPath}`);
    console.log(
      `${result.manifest.fileCount} files · ${result.manifest.totalBytes} bytes · secretsIncluded=${result.manifest.secretsIncluded}`,
    );
    if (result.manifest.excluded.length > 0) {
      console.log(
        `Excluded: ${result.manifest.excluded.slice(0, 20).join(", ")}${result.manifest.excluded.length > 20 ? " …" : ""}`,
      );
    }
    for (const warning of result.manifest.warnings) {
      console.log(`WARN: ${warning}`);
    }
  }
} catch (err) {
  console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
