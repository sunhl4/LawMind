/**
 * Durable sidecar claim.
 * Rename pending → *.inflight, and delete inflight only after the caller
 * reports the batch is already in session history. A crash before saveSession
 * redelivers the same batch instead of dropping the lawyer's note.
 */

import fs from "node:fs";
import { withExclusiveFileLock } from "../adapters/matter-storage/io.js";

export function sidecarInflightPath(filePath: string): string {
  return `${filePath}.inflight`;
}

export function claimSidecarBatch<T>(opts: {
  filePath: string;
  read: (filePath: string) => T[];
  /** True when this batch is already in persisted or in-memory history. */
  alreadyApplied: (items: T[]) => boolean;
}): T[] {
  const inflight = sidecarInflightPath(opts.filePath);
  return withExclusiveFileLock(`${opts.filePath}.lock`, () => {
    if (fs.existsSync(inflight)) {
      const held = opts.read(inflight);
      if (held.length > 0 && !opts.alreadyApplied(held)) {
        return held;
      }
      fs.rmSync(inflight, { force: true });
    }
    if (!fs.existsSync(opts.filePath)) {
      return [];
    }
    const pending = opts.read(opts.filePath);
    if (pending.length === 0) {
      fs.rmSync(opts.filePath, { force: true });
      return [];
    }
    fs.renameSync(opts.filePath, inflight);
    return pending;
  });
}
