/**
 * Child-process entry for true concurrent recordDeadline (append) races.
 * Spawned via `node --import tsx` so TypeScript service modules resolve.
 */
import { recordDeadline } from "./deadline-service.ts";

const [, , workspaceDir, matterId, title, dueAt] = process.argv;

const result = recordDeadline(workspaceDir, { matterId, title, dueAt });
process.stdout.write(JSON.stringify(result ?? null));
