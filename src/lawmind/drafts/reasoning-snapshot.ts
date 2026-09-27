/**
 * Persist LegalReasoningGraph next to draft for issue coverage and quality metrics.
 *
 * The JSON sidecar is the round-trip for the reasoning layer. Markdown serialization
 * is for lawyers to read; it does not restore the graph.
 */

import fs from "node:fs";
import path from "node:path";
import type { LegalReasoningGraph } from "../types.js";

export function reasoningSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.reasoning.json`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Shape check only. A bad file is treated as missing so render can fail closed. */
export function isLegalReasoningGraph(value: unknown): value is LegalReasoningGraph {
  if (!value || typeof value !== "object") {
    return false;
  }
  const graph = value as Record<string, unknown>;
  if (typeof graph.taskId !== "string" || graph.taskId.trim().length === 0) {
    return false;
  }
  if (graph.matterId !== undefined && typeof graph.matterId !== "string") {
    return false;
  }
  if (!Array.isArray(graph.issueTree) || !Array.isArray(graph.argumentMatrix)) {
    return false;
  }
  if (!Array.isArray(graph.authorityConflicts) || !isStringArray(graph.deliveryRisks)) {
    return false;
  }
  if (typeof graph.overallConfidence !== "number" || !Number.isFinite(graph.overallConfidence)) {
    return false;
  }
  return typeof graph.builtAt === "string" && graph.builtAt.trim().length > 0;
}

export function persistReasoningSnapshot(workspaceDir: string, graph: LegalReasoningGraph): string {
  const target = reasoningSnapshotPath(workspaceDir, graph.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, target);
  return target;
}

export function readReasoningSnapshot(
  workspaceDir: string,
  taskId: string,
): LegalReasoningGraph | undefined {
  try {
    const target = reasoningSnapshotPath(workspaceDir, taskId);
    const raw = fs.readFileSync(target, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isLegalReasoningGraph(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
