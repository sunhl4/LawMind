import fs from "node:fs/promises";
import { drainMatterProjections } from "../src/lawmind/application/services/matter-write-service.js";

/** Drain async matter projections before removing a temp workspace (test-only). */
export async function removeTestWorkspaceDir(workspaceDir: string): Promise<void> {
  await drainMatterProjections();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (attempt >= 4 || (code !== "ENOTEMPTY" && code !== "EBUSY")) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}
