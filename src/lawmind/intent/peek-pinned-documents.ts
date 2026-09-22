/**
 * Server-side file peek for the intent compiler.
 * Filename-only compile still works; peek upgrades pleading vs contract.
 */

import fs from "node:fs";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { readDocxText, readPdfText } from "../agent/tools/legal/ingest-helpers.js";
import { parseMatterKind, type MatterKind } from "../desk/matter-kind.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveLawyerLocalFile } from "../runtime/lawyer-local-file.js";
import type { DocumentPeek } from "./types.js";

export const INTENT_PEEK_MAX_CHARS = 8000;
const MAX_FILES = 4;

function isTextPath(relPath: string): boolean {
  return /\.(txt|md|csv|json|html?)$/i.test(relPath);
}

export function loadMatterKindForIntent(
  workspaceDir: string,
  matterId: string | undefined,
): MatterKind | undefined {
  const id = matterId?.trim();
  if (!id) {
    return undefined;
  }
  try {
    const matter = loadMatter(workspaceDir, id);
    if (!matter) {
      return undefined;
    }
    return parseMatterKind(matter.matterKind);
  } catch {
    return undefined;
  }
}

export async function peekPinnedDocuments(opts: {
  workspaceDir: string;
  projectDir?: string;
  pins?: ComposeContextPin[];
  maxChars?: number;
}): Promise<DocumentPeek[]> {
  const pins = opts.pins ?? [];
  const maxChars = opts.maxChars ?? INTENT_PEEK_MAX_CHARS;
  const out: DocumentPeek[] = [];
  for (const pin of pins) {
    if (out.length >= MAX_FILES) {
      break;
    }
    if (!("relPath" in pin) || typeof pin.relPath !== "string" || !pin.relPath.trim()) {
      continue;
    }
    if ("kind" in pin && pin.kind === "directory") {
      continue;
    }
    const relPath = pin.relPath.trim();
    const preferredRoot = pin.pinKind === "file" ? pin.root : undefined;
    const found = resolveLawyerLocalFile({
      workspaceDir: opts.workspaceDir,
      projectDir: opts.projectDir,
      raw: relPath,
      preferredRoot,
      pins,
    });
    if (!found) {
      out.push({ relPath });
      continue;
    }
    try {
      let text = "";
      if (/\.docx$/i.test(relPath)) {
        text = await readDocxText(found.abs);
      } else if (/\.pdf$/i.test(relPath)) {
        text = await readPdfText(found.abs);
      } else if (isTextPath(relPath)) {
        text = fs.readFileSync(found.abs, "utf8");
      }
      const peekText = text.trim().slice(0, maxChars);
      out.push(peekText ? { relPath, peekText } : { relPath });
    } catch {
      out.push({ relPath });
    }
  }
  return out;
}
