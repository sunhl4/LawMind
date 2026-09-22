/**
 * Matter JSON + CASE.md dual-write entry (no circular imports).
 */

import { projectMatterToCaseMd } from "./matter-projection.js";
import {
  createMatterIfMissing,
  type MatterCreateInput,
  type MatterRecord,
} from "./services/matter-write-service.js";

/** Create JSON truth source and project to CASE.md (idempotent). */
export async function ensureMatterWithProjection(
  workspaceDir: string,
  input: MatterCreateInput,
): Promise<MatterRecord> {
  const record = createMatterIfMissing(workspaceDir, input, { projectCase: false });
  await projectMatterToCaseMd(workspaceDir, record);
  return record;
}
