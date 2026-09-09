import fs from "node:fs";
import path from "node:path";
import { detectStanceClauseType } from "../stance/capture.js";

export type LintEscapeCandidate = {
  ts: string;
  taskId?: string;
  ruleIds: string[];
  snippet?: string;
};

function lintEscapeDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "lint");
}

function appendJsonl(dest: string, rec: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.appendFileSync(dest, `${JSON.stringify(rec)}\n`, "utf8");
}

/**
 * Three-way flywheel: rule candidate + corpus snippet + stance candidate.
 * Does not write LAWYER_PROFILE or stance items.json.
 */
export function distributeLintEscape(
  workspaceDir: string,
  row: { taskId?: string; ruleIds: string[]; snippet?: string },
): void {
  const snippet = row.snippet?.replace(/\s+/g, " ").trim().slice(0, 400);
  const ts = new Date().toISOString();
  const dir = lintEscapeDir(workspaceDir);
  appendJsonl(path.join(dir, "escape-candidates.jsonl"), {
    ts,
    taskId: row.taskId,
    ruleIds: row.ruleIds,
    ...(snippet ? { snippet } : {}),
  } satisfies LintEscapeCandidate);
  if (!snippet) {
    return;
  }
  appendJsonl(path.join(dir, "escape-corpus.jsonl"), {
    ts,
    taskId: row.taskId,
    snippet,
    ruleIds: row.ruleIds,
  });
  const clauseType = detectStanceClauseType(snippet);
  if (clauseType) {
    appendJsonl(path.join(dir, "escape-stance.jsonl"), {
      ts,
      taskId: row.taskId,
      clauseType,
      snippet,
    });
  }
}
