/**
 * Child-process entry for true concurrent transitionQueueItem races.
 * Spawned via `node --import tsx` so TypeScript service modules resolve.
 */
import { transitionQueueItem } from "./queue-write-service.ts";

const [, , workspaceDir, matterId, queueItemId, status] = process.argv;

const result = transitionQueueItem(workspaceDir, matterId, queueItemId, status);
process.stdout.write(JSON.stringify(result ?? null));
