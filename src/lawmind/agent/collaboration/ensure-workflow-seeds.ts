import fs from "node:fs";
import path from "node:path";
import { BUILTIN_WORKFLOW_TEMPLATES } from "./builtin-workflow-templates.js";

function workflowsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "workflows");
}

/**
 * Ensure built-in named workflow JSON files exist under workspace (never overwrites).
 */
export function ensureBuiltinWorkflowSeeds(workspaceDir: string): {
  created: string[];
  skipped: string[];
} {
  const dir = workflowsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  const skipped: string[] = [];
  for (const template of BUILTIN_WORKFLOW_TEMPLATES) {
    const target = path.join(dir, `${template.id}.json`);
    if (fs.existsSync(target)) {
      skipped.push(template.id);
      continue;
    }
    fs.writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    created.push(template.id);
  }
  return { created, skipped };
}
