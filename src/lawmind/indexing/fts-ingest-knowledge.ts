/**
 * Personal knowledge corpus → knowledge_fts (Markdown is source of truth).
 *
 * Includes: CASE.md / strategy / session-summary, memory/**, profiles, playbooks, golden excerpts.
 * Excludes: memory-adoption pending suggestions; restricted matters.
 */

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadMatter } from "../adapters/matter-storage/index.js";

export type KnowledgeDocKind =
  | "case"
  | "strategy"
  | "session_summary"
  | "memory"
  | "daily_log"
  | "profile"
  | "playbook"
  | "golden";

const MAX_CHUNK = 1800;
const DEFAULT_MAX_KNOWLEDGE = 40_000;

const DAILY_LOG_RE = /^memory\/\d{4}-\d{2}-\d{2}\.md$/i;

function isDailyLogPath(rel: string): boolean {
  return DAILY_LOG_RE.test(rel.replace(/\\/g, "/"));
}

function walkFiles(root: string, relBase: string, out: string[]): void {
  if (!fs.existsSync(root)) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(root, ent.name);
    const rel = path.join(relBase, ent.name).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (
        ent.name === "memory-adoption" ||
        ent.name === "node_modules" ||
        ent.name.startsWith(".")
      ) {
        continue;
      }
      walkFiles(abs, rel, out);
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    if (/\.(md|txt)$/i.test(ent.name) || ent.name.endsWith(".golden.json")) {
      out.push(rel);
    }
  }
}

function chunkMarkdown(text: string): Array<{ section: string; body: string }> {
  const parts = text.split(/^##\s+/m);
  const chunks: Array<{ section: string; body: string }> = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const nl = trimmed.indexOf("\n");
    const heading = nl === -1 ? trimmed.slice(0, 80) : trimmed.slice(0, nl).trim();
    const body = nl === -1 ? trimmed : trimmed.slice(nl + 1).trim();
    if (!body && heading.length < 4) {
      continue;
    }
    const full = body || heading;
    for (let i = 0; i < full.length; i += MAX_CHUNK) {
      chunks.push({
        section: heading.slice(0, 120),
        body: full.slice(i, i + MAX_CHUNK),
      });
    }
  }
  if (chunks.length === 0 && text.trim()) {
    const t = text.trim();
    for (let i = 0; i < t.length; i += MAX_CHUNK) {
      chunks.push({ section: "", body: t.slice(i, i + MAX_CHUNK) });
    }
  }
  return chunks;
}

function classifyPath(rel: string): KnowledgeDocKind | null {
  const p = rel.replace(/\\/g, "/");
  if (p.startsWith("memory-adoption/")) {
    return null;
  }
  if (p.startsWith("learning/suggestions")) {
    return null;
  }
  if (/^cases\/[^/]+\/CASE\.md$/i.test(p)) {
    return "case";
  }
  if (/^cases\/[^/]+\/MATTER_STRATEGY\.md$/i.test(p)) {
    return "strategy";
  }
  if (/^cases\/[^/]+\/session-summary\.md$/i.test(p)) {
    return "session_summary";
  }
  if (isDailyLogPath(p)) {
    return "daily_log";
  }
  if (p === "MEMORY.md" || p.startsWith("memory/")) {
    return "memory";
  }
  if (p === "LAWYER_PROFILE.md" || /\/PROFILE\.md$/i.test(p) || p.startsWith("assistants/")) {
    return "profile";
  }
  if (p.startsWith("playbooks/")) {
    return "playbook";
  }
  if (p.startsWith("golden/") && p.endsWith(".golden.json")) {
    return "golden";
  }
  return null;
}

function matterIdFromPath(rel: string): string {
  const m = /^cases\/([^/]+)\//i.exec(rel.replace(/\\/g, "/"));
  return m?.[1] ?? "";
}

function goldenExcerpt(raw: string): string {
  try {
    const entry = JSON.parse(raw) as {
      draft?: {
        title?: string;
        summary?: string;
        sections?: Array<{ heading?: string; body?: string }>;
      };
    };
    const d = entry.draft;
    if (!d) {
      return "";
    }
    const parts: string[] = [];
    if (d.title) {
      parts.push(d.title);
    }
    if (d.summary) {
      parts.push(d.summary);
    }
    for (const sec of d.sections ?? []) {
      if (sec.heading) {
        parts.push(sec.heading);
      }
      if (sec.body) {
        parts.push(sec.body.slice(0, 400));
      }
      if (parts.join("\n").length > 1600) {
        break;
      }
    }
    return parts.join("\n").slice(0, 2000);
  } catch {
    return "";
  }
}

function collectKnowledgeRelPaths(workspaceDir: string): string[] {
  const out: string[] = [];
  for (const name of ["MEMORY.md", "LAWYER_PROFILE.md"]) {
    if (fs.existsSync(path.join(workspaceDir, name))) {
      out.push(name);
    }
  }
  walkFiles(path.join(workspaceDir, "memory"), "memory", out);
  walkFiles(path.join(workspaceDir, "playbooks"), "playbooks", out);
  walkFiles(path.join(workspaceDir, "golden"), "golden", out);
  walkFiles(path.join(workspaceDir, "assistants"), "assistants", out);
  walkFiles(path.join(workspaceDir, "cases"), "cases", out);
  // Prefer only known case sidecar names under cases/
  return out.filter((rel) => classifyPath(rel) != null);
}

export function ingestKnowledgeRows(
  db: DatabaseSync,
  workspaceDir: string,
  maxRows = DEFAULT_MAX_KNOWLEDGE,
): { count: number; truncated: boolean } {
  const insert = db.prepare(
    `INSERT INTO knowledge_fts(path, matter_id, doc_kind, section, body) VALUES (?, ?, ?, ?, ?)`,
  );
  let count = 0;
  let truncated = false;
  const sensitivityCache = new Map<string, "restricted" | "ok">();

  for (const rel of collectKnowledgeRelPaths(workspaceDir)) {
    if (count >= maxRows) {
      truncated = true;
      break;
    }
    const kind = classifyPath(rel);
    if (!kind) {
      continue;
    }
    const matterId = matterIdFromPath(rel);
    if (matterId) {
      let sens = sensitivityCache.get(matterId);
      if (!sens) {
        try {
          const rec = loadMatter(workspaceDir, matterId);
          sens = rec?.sensitivity === "restricted" ? "restricted" : "ok";
        } catch {
          sens = "ok";
        }
        sensitivityCache.set(matterId, sens);
      }
      if (sens === "restricted") {
        continue;
      }
    }
    const abs = path.join(workspaceDir, rel);
    let raw = "";
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const text = kind === "golden" ? goldenExcerpt(raw) : raw;
    if (!text.trim()) {
      continue;
    }
    for (const chunk of chunkMarkdown(text)) {
      if (count >= maxRows) {
        truncated = true;
        return { count, truncated };
      }
      insert.run(rel.replace(/\\/g, "/"), matterId, kind, chunk.section, chunk.body);
      count++;
    }
  }
  return { count, truncated };
}

export function isDailyLogKnowledgePath(relPath: string): boolean {
  return isDailyLogPath(relPath);
}
