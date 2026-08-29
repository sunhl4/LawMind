/**
 * Local case-folder document index (M2 POC) — lists `cases/<matterId>/` files.
 */

import fs from "node:fs";
import path from "node:path";
import type { IntegrationDocumentEntry } from "./integration-types.js";

const SKIP_DIR_NAMES = new Set([".git", "node_modules"]);
const MAX_FILES = 200;
const MAX_DEPTH = 6;

function shouldSkipName(name: string): boolean {
  if (name.startsWith(".lawmind")) {
    return true;
  }
  return false;
}

function walkCaseDir(
  _baseDir: string,
  currentDir: string,
  relativePrefix: string,
  depth: number,
  out: IntegrationDocumentEntry[],
): void {
  void _baseDir;
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_FILES) {
      break;
    }
    if (shouldSkipName(ent.name)) {
      continue;
    }
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) {
        continue;
      }
      const rel = relativePrefix ? `${relativePrefix}/${ent.name}` : ent.name;
      walkCaseDir(_baseDir, path.join(currentDir, ent.name), rel, depth + 1, out);
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    const full = path.join(currentDir, ent.name);
    const rel = relativePrefix ? `${relativePrefix}/${ent.name}` : ent.name;
    try {
      const st = fs.statSync(full);
      out.push({
        name: ent.name,
        relativePath: rel,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        source: "filesystem",
      });
    } catch {
      // skip unreadable
    }
  }
}

export function listFilesystemDocuments(
  workspaceDir: string,
  matterId: string,
): IntegrationDocumentEntry[] {
  const caseDir = path.join(path.resolve(workspaceDir), "cases", matterId);
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) {
    return [];
  }
  const out: IntegrationDocumentEntry[] = [];
  walkCaseDir(caseDir, caseDir, "", 0, out);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}
