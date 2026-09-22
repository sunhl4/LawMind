/**
 * Persist LegalReasoningGraph next to draft for issue coverage and quality metrics.
 */

import fs from "node:fs";
import path from "node:path";
import type { LegalReasoningGraph } from "../types.js";

export function reasoningSnapshotPath(workspaceDir: string, taskId: string): string {
  return path.join(workspaceDir, "drafts", `${taskId}.reasoning.json`);
}

export function persistReasoningSnapshot(workspaceDir: string, graph: LegalReasoningGraph): string {
  const target = reasoningSnapshotPath(workspaceDir, graph.taskId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(graph, null, 2));
  return target;
}

export function readReasoningSnapshot(
  workspaceDir: string,
  taskId: string,
): LegalReasoningGraph | undefined {
  try {
    const target = reasoningSnapshotPath(workspaceDir, taskId);
    const raw = fs.readFileSync(target, "utf8");
    return JSON.parse(raw) as LegalReasoningGraph;
  } catch {
    return undefined;
  }
}
