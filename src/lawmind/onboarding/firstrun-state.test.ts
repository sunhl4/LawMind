import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAuditLog } from "../audit/index.js";
import type { ArtifactDraft } from "../types.js";
import {
  clearFirstrunAcceptancePending,
  maybeEmitFirstrunAcceptanceReady,
  readFirstrunAcceptancePending,
  setFirstrunAcceptancePending,
} from "./firstrun-state.js";

function minimalDraft(overrides: Partial<ArtifactDraft>): ArtifactDraft {
  return {
    taskId: "task-fr-1",
    matterId: "matter-fr-1",
    title: "Draft",
    output: "markdown",
    templateId: "default",
    summary: "",
    sections: [{ heading: "一", body: "正文" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("firstrun-state", () => {
  it("roundtrips pending file", async () => {
    const ws = path.join(os.tmpdir(), `lawmind-fr-${Date.now()}`);
    await fs.mkdir(ws, { recursive: true });
    try {
      expect(await readFirstrunAcceptancePending(ws)).toBeNull();
      await setFirstrunAcceptancePending(ws, "m-a");
      expect((await readFirstrunAcceptancePending(ws))?.matterId).toBe("m-a");
      await clearFirstrunAcceptancePending(ws);
      expect(await readFirstrunAcceptancePending(ws)).toBeNull();
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("maybeEmitFirstrunAcceptanceReady emits and clears when matter matches", async () => {
    const ws = path.join(os.tmpdir(), `lawmind-fr-${Date.now()}`);
    const auditDir = path.join(ws, "audit");
    await fs.mkdir(auditDir, { recursive: true });
    try {
      await setFirstrunAcceptancePending(ws, "matter-fr-1");
      const draft = minimalDraft({ taskId: "t1", matterId: "matter-fr-1" });
      await maybeEmitFirstrunAcceptanceReady(ws, draft, true, auditDir, "lawyer:test");
      expect(await readFirstrunAcceptancePending(ws)).toBeNull();
      const events = await readAuditLog(auditDir);
      const hit = events.filter((e) => e.kind === "ui.firstrun_acceptance_ready");
      expect(hit.length).toBe(1);
      expect(hit[0]?.taskId).toBe("t1");
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });

  it("maybeEmit does nothing when matterId mismatches", async () => {
    const ws = path.join(os.tmpdir(), `lawmind-fr-${Date.now()}`);
    const auditDir = path.join(ws, "audit");
    await fs.mkdir(auditDir, { recursive: true });
    try {
      await setFirstrunAcceptancePending(ws, "matter-a");
      const draft = minimalDraft({ matterId: "matter-b" });
      await maybeEmitFirstrunAcceptanceReady(ws, draft, true, auditDir, "lawyer:test");
      expect((await readFirstrunAcceptancePending(ws))?.matterId).toBe("matter-a");
      const events = await readAuditLog(auditDir);
      expect(events.some((e) => e.kind === "ui.firstrun_acceptance_ready")).toBe(false);
    } finally {
      await fs.rm(ws, { recursive: true, force: true });
    }
  });
});
