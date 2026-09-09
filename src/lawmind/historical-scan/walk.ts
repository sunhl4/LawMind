import fs from "node:fs";
import path from "node:path";
import { classifyDocKind, classifyLayout, proposedMatterLabel } from "./classify.js";
import {
  MAX_SCAN_DEPTH,
  MAX_SCAN_FILES,
  type HistoricalCatalogItem,
  type HistoricalScanRoot,
} from "./types.js";

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "release",
  "__pycache__",
  ".lawmind",
]);

function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR.has(name);
}

export function isPathInsideRoot(real: string, realRoot: string): boolean {
  const root = realRoot.endsWith(path.sep) ? realRoot.slice(0, -1) : realRoot;
  return real === root || real.startsWith(`${root}${path.sep}`);
}

export function walkScanRoot(root: HistoricalScanRoot): {
  items: HistoricalCatalogItem[];
  truncated: boolean;
} {
  const items: HistoricalCatalogItem[] = [];
  let truncated = false;
  const realRoot = fs.realpathSync(root.absPath);

  const visit = (absDir: string, relDir: string, depth: number): void => {
    if (truncated || depth > MAX_SCAN_DEPTH) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    const filesHere = entries.filter((e) => e.isFile()).length;
    const parentName = path.basename(absDir);
    const layout = classifyLayout(parentName, filesHere);
    const matter = proposedMatterLabel(parentName, layout);

    for (const ent of entries) {
      if (truncated) {
        return;
      }
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        continue;
      }
      if (ent.isDirectory()) {
        if (isSkippedDir(ent.name)) {
          continue;
        }
        try {
          const real = fs.realpathSync(abs);
          if (!isPathInsideRoot(real, realRoot)) {
            continue;
          }
        } catch {
          continue;
        }
        visit(abs, rel, depth + 1);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      if (items.length >= MAX_SCAN_FILES) {
        truncated = true;
        return;
      }
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      items.push({
        rootId: root.id,
        relPath: rel.replace(/\\/g, "/"),
        fileName: ent.name,
        ext: path.extname(ent.name).toLowerCase(),
        size: st.size,
        mtimeMs: st.mtimeMs,
        kind: classifyDocKind(ent.name),
        layout,
        proposedMatterLabel: matter,
      });
    }
  };

  visit(realRoot, "", 0);
  return { items, truncated };
}
