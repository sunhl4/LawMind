/**
 * Workspace-defined multi-assistant workflow templates (<workspace>/lawmind/workflows/*.json).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { workflowTemplateIsOutbound } from "../../platform/lawyer-outbound-decision.js";
import type { CollaborationWorkflow, WorkflowStep } from "../orchestrator/types.js";
import {
  resolveWorkflowTemplateKind,
  workflowTemplateKindUiLabel,
  type WorkflowTemplateKind,
} from "./workspace-workflow-template-kind.js";

export type { WorkflowTemplateKind };
export { resolveWorkflowTemplateKind, workflowTemplateKindUiLabel };

export type WorkspaceWorkflowTemplateStep = {
  stepId: string;
  assignee: string;
  /** Prefer resolving live assistant via Role when present (Wave B). */
  assigneeRoleId?: string;
  task: string;
  dependsOn: string[];
  reviewBy?: string;
  /** Default true when omitted */
  autoApprove?: boolean;
};

export type WorkspaceWorkflowTemplateFile = {
  id: string;
  name: string;
  /** Lawyer-facing agent name (Claude for Legal style), optional display label */
  namedAgent?: string;
  description?: string;
  steps: WorkspaceWorkflowTemplateStep[];
  practiceArea?: string;
  deliverableType?: string;
  riskLevel?: "low" | "medium" | "high";
  audience?: "solo" | "firm";
  starterPrompt?: string;
  acceptancePackRequired?: boolean;
  requiredSources?: string[];
  schedulable?: boolean;
  /**
   * 模板级工具预批准（仅限 executor 白名单内的「待拍板」类工具，如
   * render_tracked_draft / prepare_outbound_mail）：
   * 供自动化（邮件合同短路径等）在 strict Edition 下不必逐步等待律师批准；
   * 不放宽 send_email 等有外部副作用的工具。
   */
  preApproveToolNames?: string[];
  /** Glob patterns; desktop may suggest workflow when pinned paths match */
  triggerPaths?: string[];
  /** Explicit UI category; when omitted, resolved via `resolveWorkflowTemplateKind`. */
  kind?: WorkflowTemplateKind;
};

export type WorkspaceWorkflowTemplateListItem = {
  id: string;
  name: string;
  namedAgent?: string;
  description: string;
  stepCount: number;
  practiceArea?: string;
  deliverableType?: string;
  riskLevel?: "low" | "medium" | "high";
  audience?: string;
  starterPrompt?: string;
  acceptancePackRequired?: boolean;
  requiredSources?: string[];
  schedulable?: boolean;
  /** Glob paths; when pinned chat context matches, UI may suggest this workflow */
  triggerPaths?: string[];
  kind?: WorkflowTemplateKind;
  /** 会把材料发给客户/对方（配置时应提醒是否开签批审阅）。 */
  outbound?: boolean;
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
          namedAgent: typeof parsed.namedAgent === "string" ? parsed.namedAgent : undefined,
          description: typeof parsed.description === "string" ? parsed.description : "",
          stepCount: parsed.steps.length,
          practiceArea: typeof parsed.practiceArea === "string" ? parsed.practiceArea : undefined,
          deliverableType:
            typeof parsed.deliverableType === "string" ? parsed.deliverableType : undefined,
          riskLevel:
            parsed.riskLevel === "low" ||
            parsed.riskLevel === "medium" ||
            parsed.riskLevel === "high"
              ? parsed.riskLevel
              : undefined,
          audience: typeof parsed.audience === "string" ? parsed.audience : undefined,
          starterPrompt:
            typeof parsed.starterPrompt === "string" ? parsed.starterPrompt : undefined,
          acceptancePackRequired: parsed.acceptancePackRequired === true,
          requiredSources: Array.isArray(parsed.requiredSources)
            ? parsed.requiredSources.filter((x): x is string => typeof x === "string")
            : undefined,
          schedulable: parsed.schedulable === true,
          triggerPaths: Array.isArray(parsed.triggerPaths)
            ? parsed.triggerPaths.filter((x): x is string => typeof x === "string")
            : undefined,
          kind: parsed.kind === "office" || parsed.kind === "matter" ? parsed.kind : undefined,
          outbound: workflowTemplateIsOutbound(parsed),
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
  return task.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      return merged[key] ?? "";
    }
    // Optional automation brief — omit rather than leave a raw token in the prompt.
    if (key === "instruction" || key === "automationId") {
      return "";
    }
    return `{{${key}}}`;
  });
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
    assigneeRoleId: t.assigneeRoleId,
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
    ...(Array.isArray(template.preApproveToolNames) && template.preApproveToolNames.length > 0
      ? { preApproveToolNames: [...template.preApproveToolNames] }
      : {}),
  };
}
