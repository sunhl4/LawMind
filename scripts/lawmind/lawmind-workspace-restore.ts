/**
 * Restore a LawMind workspace backup into an empty directory.
 *
 * Usage:
 *   pnpm lawmind:workspace:restore -- --from <zip> --to <dir> [--force] [--json]
 *
 * Refuses a non-empty target unless `--force`; never deletes existing files.
 */

import path from "node:path";
import { restoreWorkspaceBackup } from "../../src/lawmind/platform/workspace-backup.js";

const argv = process.argv.slice(2);

function valueOf(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const archivePath = valueOf("--from");
const targetDir = valueOf("--to");
const force = argv.includes("--force");
const asJson = argv.includes("--json");

if (!archivePath || !targetDir) {
  console.error("Usage: pnpm lawmind:workspace:restore -- --from <zip> --to <dir> [--force]");
  process.exit(2);
}

try {
  const result = await restoreWorkspaceBackup({
    archivePath: path.resolve(process.cwd(), archivePath),
    targetDir: path.resolve(process.cwd(), targetDir),
    force,
  });
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Restored ${result.restoredFiles} files into ${path.resolve(process.cwd(), targetDir)}`,
    );
    console.log(
      `Backup: ${result.manifest.workspaceName} · ${result.manifest.createdAt} · ${result.manifest.fileCount} files`,
    );
    if (result.manifest.secretsIncluded) {
      console.log("WARN: 这份备份包含密钥；恢复后请按需轮换，且不要把归档留在共享位置。");
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.join(", ")}`);
    }
  }
} catch (err) {
  console.error(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
