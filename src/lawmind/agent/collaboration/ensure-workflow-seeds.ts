import fs from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_TEMPLATES } from "./builtin-workflow-templates.js";
import type { WorkspaceWorkflowTemplateFile } from "./workspace-workflow-templates.js";

function workflowsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "workflows");
}

/** Seeds upgraded to multi-step team pipelines — rewrite if workspace still has single-step copy. */
const TEAM_PIPELINE_UPGRADE_IDS = new Set(["contract-review", "nda-triage"]);

function shouldUpgradeSeed(template: WorkspaceWorkflowTemplateFile, existingRaw: string): boolean {
  if (!TEAM_PIPELINE_UPGRADE_IDS.has(template.id)) {
    return false;
  }
  if (template.steps.length < 2) {
    return false;
  }
  try {
    const existing = JSON.parse(existingRaw) as WorkspaceWorkflowTemplateFile;
    if (!Array.isArray(existing.steps)) {
      return true;
    }
    if (existing.steps.length < 2) {
      return true;
    }
    const hasRole = existing.steps.some((s) => typeof s.assigneeRoleId === "string");
    return !hasRole;
  } catch {
    return true;
  }
}

/**
 * Ensure built-in named workflow JSON files exist under workspace.
 * Never overwrites arbitrary user edits, except known team-pipeline upgrades
 * when the on-disk seed is still the legacy single-step shape.
 */
export function ensureBuiltinWorkflowSeeds(workspaceDir: string): {
  created: string[];
  skipped: string[];
  upgraded: string[];
} {
  const dir = workflowsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];
  const upgraded: string[] = [];
  for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
    const target = path.join(dir, `${template.id}.json`);
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target, "utf8");
      if (shouldUpgradeSeed(template, raw)) {
        fs.writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`, "utf8");
        upgraded.push(template.id);
      } else {
        skipped.push(template.id);
      }
      continue;
    }
    fs.writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    created.push(template.id);
  }
  return { created, skipped, upgraded };
}
