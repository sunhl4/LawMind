/**
 * Child-process entry for true concurrent resolveApproval races.
 * Spawned via `node --import tsx` so TypeScript service modules resolve.
 */
import { resolveApproval } from "./approval-service.ts";

const [
  ,
  ,
  workspaceDir,
  matterId,
  approvalId,
  status,
  resolvedBy,
] = process.argv;

const result = resolveApproval(workspaceDir, matterId, approvalId, {
  status,
  resolvedBy,
});
process.stdout.write(JSON.stringify(result));
