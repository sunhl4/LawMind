import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistResearchSnapshot } from "../drafts/research-snapshot.js";
import {
  isResearchDeliverableWritePath,
  shouldRefuseResearchWriteBypass,
} from "./research-write-bypass-gate.js";

describe("research-write-bypass-gate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("flags artifacts markdown paths", () => {
    expect(isResearchDeliverableWritePath("artifacts/memo.md")).toBe(true);
    expect(isResearchDeliverableWritePath("notes/scratch.md")).toBe(false);
  });

  it("refuses artifacts markdown without research context", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bypass-"));
    dirs.push(ws);
    const r = shouldRefuseResearchWriteBypass({
      workspaceDir: ws,
      filePath: "artifacts/fake-delivery.md",
    });
    expect(r.refuse).toBe(true);
  });

  it("refuses artifacts docx/pptx without linkedTaskId", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bypass-"));
    dirs.push(ws);
    expect(
      shouldRefuseResearchWriteBypass({
        workspaceDir: ws,
        filePath: "artifacts/合规备忘录.docx",
      }).refuse,
    ).toBe(true);
    expect(
      shouldRefuseResearchWriteBypass({
        workspaceDir: ws,
        filePath: "artifacts/x.pptx",
      }).refuse,
    ).toBe(true);
  });

  it("refuses when linked task has research snapshot", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bypass-"));
    dirs.push(ws);
    const taskId = "11111111-1111-4111-8111-111111111111";
    persistResearchSnapshot(ws, {
      taskId,
      query: "NEV",
      sources: [],
      claims: [],
      riskFlags: [],
      missingItems: [],
      requiresReview: false,
      completedAt: new Date().toISOString(),
    });
    const r = shouldRefuseResearchWriteBypass({
      workspaceDir: ws,
      filePath: "artifacts/report.docx",
      linkedTaskId: taskId,
    });
    expect(r.refuse).toBe(true);
  });

  it("allows ordinary workspace notes", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-bypass-"));
    dirs.push(ws);
    const r = shouldRefuseResearchWriteBypass({
      workspaceDir: ws,
      filePath: "notes/todo.md",
    });
    expect(r.refuse).toBe(false);
  });
});
