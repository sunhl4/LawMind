/**
 * Memory write gateway — single entry for Markdown memory mutations.
 *
 * New agent/engine writes should go through this module so adoption-service
 * can eventually own all persistence. Direct `memory/index.ts` append helpers
 * remain for engine hot paths but are routed here from agent tools.
 */

import { suggestMemoryAdoption } from "./adoption-service.js";
import {
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseTaskGoal,
  ensureCaseWorkspace,
} from "./index.js";

export type CaseMemorySection = "core_issue" | "risk" | "progress" | "artifact" | "task_goal";

const CASE_WRITERS: Record<
  CaseMemorySection,
  (ws: string, mid: string, text: string) => Promise<void>
> = {
  core_issue: appendCaseCoreIssue,
  risk: appendCaseRiskNote,
  progress: appendCaseProgress,
  artifact: appendCaseArtifact,
  task_goal: appendCaseTaskGoal,
};

export type WriteCaseMemoryParams = {
  workspaceDir: string;
  matterId: string;
  section: CaseMemorySection;
  content: string;
  /** When true, also enqueue adoption record (Inspector visibility). */
  trackAdoption?: boolean;
  sourceTaskId?: string;
  origin?: "engine" | "lawyer" | "agent";
};

/** Write case memory section — engine path with optional adoption tracking. */
export async function writeCaseMemorySection(params: WriteCaseMemoryParams): Promise<void> {
  const { workspaceDir, matterId, section, content } = params;
  await ensureCaseWorkspace(workspaceDir, matterId);
  await CASE_WRITERS[section](workspaceDir, matterId, content);
  // Case append helpers already mirror to adoption-service (auto_adopted).
  // trackAdoption reserved for future non-case write paths.
  void params.trackAdoption;
}

export { suggestMemoryAdoption };
