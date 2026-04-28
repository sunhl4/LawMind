/**
 * Workspace-defined multi-assistant workflow templates (<workspace>/lawmind/workflows/*.json).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CollaborationWorkflow, WorkflowStep } from "../orchestrator/types.js";

export type WorkspaceWorkflowTemplateStep = {
  stepId: string;
  assignee: string;
  task: string;
  dependsOn: string[];
  reviewBy?: string;
  /** Default true when omitted */
  autoApprove?: boolean;
};

export type WorkspaceWorkflowTemplateFile = {
  id: string;
  name: string;
  description?: string;
  steps: WorkspaceWorkflowTemplateStep[];
};

export type WorkspaceWorkflowTemplateListItem = {
  id: string;
  name: string;
  description: string;
  stepCount: number;
};

function workflowsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "workflows");
}

export function listWorkspaceWorkflowTemplates(
  workspaceDir: string,
): WorkspaceWorkflowTemplateListItem[] {
  const dir = workflowsDir(workspaceDir);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: WorkspaceWorkflowTemplateListItem[] = [];
  for (const file of files.toSorted()) {
    const full = path.join(dir, file);
    try {
      const raw = fs.readFileSync(full, "utf8");
      const parsed = JSON.parse(raw) as WorkspaceWorkflowTemplateFile;
      if (
        typeof parsed.id === "string" &&
        typeof parsed.name === "string" &&
        Array.isArray(parsed.steps)
      ) {
        out.push({
          id: parsed.id,
          name: parsed.name,
          description: typeof parsed.description === "string" ? parsed.description : "",
          stepCount: parsed.steps.length,
        });
      }
    } catch {
      /* skip invalid */
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}

export function readWorkspaceWorkflowTemplate(
  workspaceDir: string,
  templateId: string,
): WorkspaceWorkflowTemplateFile | undefined {
  const safeId = templateId.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId || safeId !== templateId) {
    return undefined;
  }
  const dir = workflowsDir(workspaceDir);
  const full = path.join(dir, `${safeId}.json`);
  try {
    const raw = fs.readFileSync(full, "utf8");
    const parsed = JSON.parse(raw) as WorkspaceWorkflowTemplateFile;
    if (typeof parsed.id !== "string" || !Array.isArray(parsed.steps)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function substituteTask(task: string, vars: Record<string, string>, matterId?: string): string {
  const merged: Record<string, string> = { ...vars };
  if (matterId) {
    merged.matterId = matterId;
  }
  return task.replace(/\{\{(\w+)\}\}/g, (_, key: string) => merged[key] ?? `{{${key}}}`);
}

/**
 * Build a runnable CollaborationWorkflow from a workspace template.
 */
export function instantiateCollaborationWorkflowFromTemplate(
  template: WorkspaceWorkflowTemplateFile,
  opts: {
    matterId?: string;
    createdBy: string;
    vars?: Record<string, string>;
    workflowId?: string;
  },
): CollaborationWorkflow {
  const workflowId = opts.workflowId ?? randomUUID();
  const now = new Date().toISOString();
  const steps: WorkflowStep[] = template.steps.map((t) => ({
    stepId: t.stepId,
    assignee: t.assignee,
    task: substituteTask(t.task, opts.vars ?? {}, opts.matterId),
    dependsOn: [...t.dependsOn],
    reviewBy: t.reviewBy,
    autoApprove: t.autoApprove !== false,
    status: "pending",
  }));

  return {
    workflowId,
    name: template.name,
    description: template.description ?? "",
    matterId: opts.matterId,
    steps,
    status: "draft",
    createdBy: opts.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}
