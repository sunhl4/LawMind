/**
 * Per-matter external DMS keys (`cases/<matterId>/.lawmind-dms.json`).
 */

import fs from "node:fs";
import path from "node:path";

export type MatterDmsMapping = {
  imanage?: { matterKey?: string };
  sharepoint?: { siteId?: string; driveId?: string };
};

export function matterDmsMapPath(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", matterId, ".lawmind-dms.json");
}

export function readMatterDmsMapping(
  workspaceDir: string,
  matterId: string,
): MatterDmsMapping | undefined {
  const filePath = matterDmsMapPath(workspaceDir, matterId);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MatterDmsMapping;
  } catch {
    return undefined;
  }
}
