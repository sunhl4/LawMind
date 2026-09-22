/**
 * Child-process entry for true concurrent requestApproval (append) races.
 * Spawned via `node --import tsx` so TypeScript service modules resolve.
 */
import { requestApproval } from "./approval-service.ts";

const [, , workspaceDir, matterId, requestedBy, reason, riskLevel] = process.argv;

const result = requestApproval(workspaceDir, {
  matterId,
  requestedBy,
  reason,
  riskLevel,
});
process.stdout.write(JSON.stringify(result ?? null));
