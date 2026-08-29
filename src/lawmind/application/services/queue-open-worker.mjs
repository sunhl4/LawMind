/**
 * Child-process entry for true concurrent openQueueItem (append) races.
 * Spawned via `node --import tsx` so TypeScript service modules resolve.
 */
import { openQueueItem } from "./queue-write-service.ts";

const [, , workspaceDir, matterId, kind, title] = process.argv;

const result = openQueueItem(workspaceDir, {
  matterId,
  kind,
  title,
});
process.stdout.write(JSON.stringify(result ?? null));
