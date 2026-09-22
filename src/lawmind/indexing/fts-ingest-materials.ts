/**
 * Matter materials corpus → materials_fts (trigram).
 *
 * Extracts text from cases/<id>/materials files (txt/md/docx/doc/pdf/xlsx) so
 * 材料检索 can answer with {relPath, page} citations. Images are not bulk-OCR'd.
 * Incremental by mtime: unchanged files are not re-extracted.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  readDocxText,
  readPdfText,
  readXlsxPlainText,
} from "../agent/tools/legal/ingest-helpers.js";
import { isBinaryWordDocPath, readBinaryWordDocText } from "../mail/read-word-binary.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BODY_CHARS = 60_000;
const CHUNK_CHARS = 1_800;
const DEFAULT_MAX_ROWS = 60_000;

type MaterialFileRow = {
  matterId: string;
  relPath: string;
  fileName: string;
  abs: string;
  mtime: number;
};

function walkMaterials(workspaceDir: string): MaterialFileRow[] {
  const casesDir = path.join(workspaceDir, "cases");
  const out: MaterialFileRow[] = [];
  let matterNames: string[];
  try {
    matterNames = fs.readdirSync(casesDir);
  } catch {
    return [];
  }
  for (const matterId of matterNames) {
    const materialsDir = path.join(casesDir, matterId, "materials");
    let entries: string[];
    try {
      entries = fs.readdirSync(materialsDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".")) {
        continue;
      }
      const abs = path.join(materialsDir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        continue;
      }
      out.push({
        matterId,
        relPath: `cases/${matterId}/materials/${name}`,
        fileName: name,
        abs,
        mtime: Math.floor(stat.mtimeMs),
      });
    }
  }
  return out;
}

async function extractMaterialText(abs: string, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  try {
    if (/\.(txt|md|markdown|csv|log|text)$/i.test(lower)) {
      return fs.readFileSync(abs, "utf8");
    }
    if (lower.endsWith(".docx")) {
      return await readDocxText(abs);
    }
    if (isBinaryWordDocPath(lower)) {
      return readBinaryWordDocText(abs);
    }
    if (lower.endsWith(".pdf")) {
      return await readPdfText(abs);
    }
    if (/\.(xlsx|xls)$/i.test(lower)) {
      return await readXlsxPlainText(abs);
    }
  } catch {
    return "";
  }
  return "";
}

function chunkBody(text: string): string[] {
  const body = text.replace(/\r/g, "").trim();
  if (!body) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < body.length && out.length * CHUNK_CHARS < MAX_BODY_CHARS; i += CHUNK_CHARS) {
    out.push(body.slice(i, i + CHUNK_CHARS));
  }
  return out;
}

function insertMaterialRows(
  db: DatabaseSync,
  rows: MaterialFileRow[],
  maxRows: number,
  startCount: number,
): Promise<{ count: number; truncated: boolean }> {
  const insert = db.prepare(
    `INSERT INTO materials_fts(matter_id, rel_path, file_name, page, body, mtime) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let count = startCount;
  let truncated = false;
  return (async () => {
    for (const row of rows) {
      const text = await extractMaterialText(row.abs, row.fileName);
      const chunks = chunkBody(text);
      for (let i = 0; i < chunks.length; i++) {
        if (count >= maxRows) {
          truncated = true;
          return { count: count - startCount, truncated };
        }
        insert.run(row.matterId, row.relPath, row.fileName, i + 1, chunks[i], row.mtime);
        count++;
      }
    }
    return { count: count - startCount, truncated };
  })();
}

/** Full re-ingest (called after clearFtsTables on rebuild). */
export async function ingestMaterialsRows(
  db: DatabaseSync,
  workspaceDir: string,
  maxRows = DEFAULT_MAX_ROWS,
): Promise<{ count: number; truncated: boolean }> {
  return insertMaterialRows(db, walkMaterials(workspaceDir), maxRows, 0);
}

/**
 * mtime-incremental ingest: delete rows for changed/deleted files, insert rows
 * for new/changed ones. Used by search-time refresh so 材料检索 does not need a
 * full rebuild.
 */
export async function ingestMaterialsIncremental(
  db: DatabaseSync,
  workspaceDir: string,
  maxRows = DEFAULT_MAX_ROWS,
): Promise<{ added: number; removed: number }> {
  const current = walkMaterials(workspaceDir);
  const currentByPath = new Map(current.map((r) => [r.relPath, r]));
  const existing = db
    .prepare(`SELECT DISTINCT rel_path AS relPath, mtime FROM materials_fts`)
    .all() as Array<{ relPath: string; mtime: number }>;
  let removed = 0;
  const del = db.prepare(`DELETE FROM materials_fts WHERE rel_path = ?`);
  for (const row of existing) {
    const cur = currentByPath.get(row.relPath);
    if (!cur || cur.mtime !== row.mtime) {
      del.run(row.relPath);
      removed++;
    }
  }
  const existingFresh = new Map(
    (
      db.prepare(`SELECT DISTINCT rel_path AS relPath, mtime FROM materials_fts`).all() as Array<{
        relPath: string;
        mtime: number;
      }>
    ).map((r) => [r.relPath, r.mtime]),
  );
  const toAdd = current.filter((r) => existingFresh.get(r.relPath) !== r.mtime);
  const countRow = db.prepare(`SELECT count(*) AS c FROM materials_fts`).get() as { c: number };
  const result = await insertMaterialRows(db, toAdd, maxRows, countRow.c);
  return { added: result.count, removed };
}
