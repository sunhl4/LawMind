import fs from "node:fs";
import path from "node:path";
import type { ClauseGraph } from "../reasoning/clause-graph.js";

export function clauseSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.clauses.json`);
}

export function persistClauseSnapshot(workspaceDir: string, graph: ClauseGraph): string {
  const target = clauseSnapshotPath(workspaceDir, graph.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(graph, null, 2));
  return target;
}

export function readClauseSnapshot(workspaceDir: string, taskId: string): ClauseGraph | undefined {
  try {
    const raw = fs.readFileSync(clauseSnapshotPath(workspaceDir, taskId), "utf8");
    return JSON.parse(raw) as ClauseGraph;
  } catch {
    return undefined;
  }
}
