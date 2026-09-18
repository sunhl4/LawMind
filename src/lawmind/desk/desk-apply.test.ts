/**
 * Desk apply helpers — shared by workbench HTTP and agent tools.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDeadlinesForMatter } from "../application/services/deadline-service.js";
import { createMatterIfMissing, readMatter } from "../application/services/matter-write-service.js";
import {
  applyIntakeBrief,
  applyLegalEvents,
  applyMatterProfile,
  createMatterFromIntake,
  revertDeskWrite,
} from "./desk-apply.js";
import { loadIntakeBrief, saveIntakeBrief, compileIntakeBrief } from "./intake-brief.js";

describe("desk-apply", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
    tmp.length = 0;
  });

  function ws(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-apply-"));
    tmp.push(dir);
    return dir;
  }

  it("writes hearing deadlines and updates docket.hearingAt", async () => {
    const workspaceDir = ws();
    createMatterIfMissing(workspaceDir, { matterId: "m1", title: "案", matterKind: "litigation" });
    const result = await applyLegalEvents(workspaceDir, "m1", [
      {
        eventKind: "hearing",
        title: "开庭",
        dueAt: "2026-10-12T01:00:00.000Z",
        notes: "传票",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.deadlineIds).toHaveLength(1);
    expect(result.writeId).toMatch(/^dw-/);
    const deadlines = listDeadlinesForMatter(workspaceDir, "m1");
    expect(deadlines.some((d) => d.title === "开庭")).toBe(true);
    expect(readMatter(workspaceDir, "m1")?.docket?.hearingAt).toBe("2026-10-12T01:00:00.000Z");
  });

  it("refuses to write when matter is missing (agent path)", async () => {
    const workspaceDir = ws();
    const result = await applyLegalEvents(workspaceDir, "ghost", [
      { eventKind: "hearing", title: "开庭", dueAt: "2026-10-12T01:00:00.000Z" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("不存在");
    expect(listDeadlinesForMatter(workspaceDir, "ghost")).toHaveLength(0);
  });

  it("refuses events without dueAt", async () => {
    const workspaceDir = ws();
    createMatterIfMissing(workspaceDir, { matterId: "m2", title: "案" });
    const result = await applyLegalEvents(workspaceDir, "m2", [
      { eventKind: "hearing", title: "开庭" },
    ]);
    expect(result.ok).toBe(false);
    expect(listDeadlinesForMatter(workspaceDir, "m2")).toHaveLength(0);
  });

  it("confirms intake brief with writeId and can revert", async () => {
    const workspaceDir = ws();
    createMatterIfMissing(workspaceDir, { matterId: "talk", title: "谈话案" });
    const draft = compileIntakeBrief({
      matterId: "talk",
      transcript: "客户希望解除合同并退回定金。已付定金未交货。",
      workspaceDir,
    });
    await saveIntakeBrief(workspaceDir, draft);
    expect(loadIntakeBrief(workspaceDir, "talk")?.confirmedAt).toBeUndefined();

    const applied = await applyIntakeBrief(workspaceDir, "talk");
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.brief.confirmedAt).toBeTruthy();

    const reverted = await revertDeskWrite(workspaceDir, "talk", applied.writeId);
    expect(reverted.ok).toBe(true);
    expect(loadIntakeBrief(workspaceDir, "talk")?.confirmedAt).toBeUndefined();
  });

  it("updates matter profile and reverts snapshot", async () => {
    const workspaceDir = ws();
    createMatterIfMissing(workspaceDir, { matterId: "p1", title: "旧标题" });
    const applied = await applyMatterProfile(workspaceDir, {
      matterId: "p1",
      title: "新标题",
      docket: { caseNo: "（2026）京01民初1号" },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(readMatter(workspaceDir, "p1")?.title).toBe("新标题");
    expect(readMatter(workspaceDir, "p1")?.docket?.caseNo).toContain("京01");

    const reverted = await revertDeskWrite(workspaceDir, "p1", applied.writeId);
    expect(reverted.ok).toBe(true);
    expect(readMatter(workspaceDir, "p1")?.title).toBe("旧标题");
  });

  it("createMatterFromIntake allocates a new matter", async () => {
    const workspaceDir = ws();
    const created = await createMatterFromIntake({
      workspaceDir,
      title: "新建卷宗甲",
      matterKind: "litigation",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(readMatter(workspaceDir, created.matterId)?.title).toBe("新建卷宗甲");
  });

  it("revert removes applied deadlines", async () => {
    const workspaceDir = ws();
    createMatterIfMissing(workspaceDir, { matterId: "rev", title: "案" });
    const applied = await applyLegalEvents(workspaceDir, "rev", [
      { eventKind: "filing", title: "举证期限", dueAt: "2026-11-01T01:00:00.000Z" },
    ]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(listDeadlinesForMatter(workspaceDir, "rev")).toHaveLength(1);
    const reverted = await revertDeskWrite(workspaceDir, "rev", applied.writeId);
    expect(reverted.ok).toBe(true);
    expect(listDeadlinesForMatter(workspaceDir, "rev")).toHaveLength(0);
  });
});
