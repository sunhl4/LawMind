#!/usr/bin/env node
/**
 * CLI: seed built-in workflow templates into LAWMIND_WORKSPACE_DIR.
 * Usage: LAWMIND_WORKSPACE_DIR=/path pnpm lawmind:seed:workflows
 */

import { ensureBuiltinWorkflowSeeds } from "../../src/lawmind/agent/collaboration/ensure-workflow-seeds.js";

const workspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
if (!workspaceDir) {
  console.error("LAWMIND_WORKSPACE_DIR is required");
  process.exit(1);
}

const result = ensureBuiltinWorkflowSeeds(workspaceDir);
console.log(JSON.stringify(result, null, 2));
