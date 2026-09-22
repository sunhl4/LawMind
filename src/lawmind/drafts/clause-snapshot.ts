import fs from "node:fs";
import path from "node:path";
import {
  buildClauseGraphFromDraft,
  type ClauseGraph,
  type ClauseNode,
} from "../reasoning/clause-graph.js";
import type { ArtifactDraft } from "../types.js";

export function clauseSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.clauses.json`);
}

export function persistClauseSnapshot(workspaceDir: string, graph: ClauseGraph): string {
  const target = clauseSnapshotPath(workspaceDir, graph.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(graph, null, 2));
  return target;
}

function normalizeClauseNode(raw: Partial<ClauseNode>, index: number): ClauseNode {
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `c${index + 1}`,
    heading: typeof raw.heading === "string" ? raw.heading : `段落 ${index + 1}`,
    body: typeof raw.body === "string" ? raw.body : "",
    kind:
      raw.kind === "article" || raw.kind === "heading" || raw.kind === "paragraph"
        ? raw.kind
        : "paragraph",
    risks: Array.isArray(raw.risks)
      ? raw.risks.filter((item): item is string => typeof item === "string")
      : [],
    missing: Array.isArray(raw.missing)
      ? raw.missing.filter((item): item is string => typeof item === "string")
      : [],
    criticNotes: Array.isArray(raw.criticNotes)
      ? raw.criticNotes.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function readClauseSnapshot(workspaceDir: string, taskId: string): ClauseGraph | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(clauseSnapshotPath(workspaceDir, taskId), "utf8"),
    ) as Partial<ClauseGraph>;
    const clauses = Array.isArray(raw.clauses)
      ? raw.clauses.map((clause, index) =>
          normalizeClauseNode(clause as Partial<ClauseNode>, index),
        )
      : [];
    return {
      taskId: typeof raw.taskId === "string" ? raw.taskId : taskId,
      clauses,
      riskCount:
        typeof raw.riskCount === "number"
          ? raw.riskCount
          : clauses.reduce((sum, c) => sum + c.risks.length, 0),
      missingCount:
        typeof raw.missingCount === "number"
          ? raw.missingCount
          : clauses.reduce((sum, c) => sum + c.missing.length, 0),
      builtAt: typeof raw.builtAt === "string" ? raw.builtAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function resolveClauseGraphForDraft(
  workspaceDir: string,
  draft: ArtifactDraft,
): ClauseGraph {
  return readClauseSnapshot(workspaceDir, draft.taskId) ?? buildClauseGraphFromDraft(draft);
}
