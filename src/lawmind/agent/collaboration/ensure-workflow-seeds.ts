import fs from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_TEMPLATES } from "./builtin-workflow-templates.js";
import type { WorkspaceWorkflowTemplateFile } from "./workspace-workflow-templates.js";

function workflowsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "workflows");
}

/** Seeds upgraded to multi-step team pipelines — rewrite if workspace still has single-step copy. */
const TEAM_PIPELINE_UPGRADE_IDS = new Set(["contract-review", "nda-triage"]);

/** Research / training seeds: upgrade when missing outline or deep_research language. */
const RESEARCH_OUTLINE_UPGRADE_IDS = new Set([
  "training-ppt",
  "office-research-report",
  "compliance-research-memo",
]);

/** Legacy mail-contract had 5 steps (ingest/surgical/opinion/export/handoff); collapse to short path. */
const MAIL_CONTRACT_SHORT_PATH_ID = "mail-contract-redline";

function shouldUpgradeSeed(template: WorkspaceWorkflowTemplateFile, existingRaw: string): boolean {
  if (template.id === MAIL_CONTRACT_SHORT_PATH_ID) {
    try {
      const existing = JSON.parse(existingRaw) as WorkspaceWorkflowTemplateFile;
      if (!Array.isArray(existing.steps)) {
        return true;
      }
      const stepIds = new Set(existing.steps.map((s) => String(s.stepId ?? "")));
      const redlineTask =
        existing.steps.find((s) => String(s.stepId ?? "") === "redline")?.task ?? "";
      const missingInstructionVar = !String(redlineTask).includes("{{instruction}}");
      // Lawyer-capability gate: must require real redline hunks + surgical apply tool.
      const missingHunkGate =
        !String(redlineTask).includes("redlinePending") ||
        !String(redlineTask).includes("空修订") ||
        !String(redlineTask).includes("apply_surgical_edits");
      // Old seeds: hard ban-lists / missing craft_check / missing span-local minimal-edit discipline.
      const missingSpanDiscipline =
        !/硬门禁|最短|能改几个字/.test(String(redlineTask)) ||
        !/整句|整段/.test(String(redlineTask));
      const shallowEditQuota =
        /最多\s*24/.test(String(redlineTask)) ||
        /应改尽改/.test(String(redlineTask)) ||
        /2[–-]3\s*处/.test(String(redlineTask)) ||
        !String(redlineTask).includes("craft_check") ||
        missingSpanDiscipline;
      const legacy =
        stepIds.has("ingest") ||
        stepIds.has("surgical_edit") ||
        stepIds.has("opinion") ||
        stepIds.has("export_tracked") ||
        existing.steps.length > template.steps.length ||
        // Automation puts the full mail+attachment brief in vars.instruction; without
        // {{instruction}} the agent never sees the baseline path and death-spirals on list_*.
        missingInstructionVar ||
        missingHunkGate ||
        shallowEditQuota;
      return legacy;
    } catch {
      return true;
    }
  }
  if (RESEARCH_OUTLINE_UPGRADE_IDS.has(template.id)) {
    try {
      const existing = JSON.parse(existingRaw) as WorkspaceWorkflowTemplateFile;
      if (!Array.isArray(existing.steps) || existing.steps.length < 2) {
        return true;
      }
      const blob = JSON.stringify(existing);
      const missingOutline =
        !blob.includes("outline_confirm") && !blob.includes("research_outline_confirm");
      const missingDeep = !blob.includes("deep_research");
      return missingOutline || missingDeep;
    } catch {
      return true;
    }
  }
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
