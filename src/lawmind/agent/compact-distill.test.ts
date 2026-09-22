import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listPendingMemorySuggestions } from "../memory/adoption-service.js";
import { distillCompactIntoMemorySuggestions } from "./compact-distill.js";
import { createSession } from "./session.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-distill-"));
}

describe("compact-distill", () => {
  it("suggests lawyer preference lines from dialogue", async () => {
    const ws = tmpDir();
    const audit = path.join(ws, "audit");
    fs.mkdirSync(audit, { recursive: true });
    const session = createSession({ workspaceDir: ws, actorId: "lawyer-1" });
    const source = [
      {
        role: "user" as const,
        content: "以后请默认用正式书面语气回复，不要口语。",
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant" as const,
        content: "好的，将按正式书面语气回复。",
        timestamp: new Date().toISOString(),
      },
    ];
    const result = await distillCompactIntoMemorySuggestions({
      workspaceDir: ws,
      auditDir: audit,
      session,
      sourceMessages: source,
    });
    expect(result.preferenceSnippetCount).toBeGreaterThanOrEqual(1);
    expect(result.suggestionIds.length).toBeGreaterThanOrEqual(1);
    const pending = await listPendingMemorySuggestions(ws, { scope: "lawyer" });
    expect(pending.some((p) => p.kind === "lawyer.profile_learning")).toBe(true);
  });

  it("suggests matter progress without writing session-summary.md", async () => {
    const ws = tmpDir();
    const audit = path.join(ws, "audit");
    fs.mkdirSync(audit, { recursive: true });
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer-1",
      matterId: "matter-distill",
    });
    const source = [
      {
        role: "user" as const,
        content: "本案核心争点是管辖条款是否有效，请记住对方主张适用被告住所地法院。",
        timestamp: new Date().toISOString(),
      },
      {
        role: "assistant" as const,
        content: "已记录管辖争点与对方主张，下一步核验合同争议解决条款原文。",
        timestamp: new Date().toISOString(),
      },
    ];
    const result = await distillCompactIntoMemorySuggestions({
      workspaceDir: ws,
      auditDir: audit,
      session,
      sourceMessages: source,
    });
    expect(result.sessionSummaryAppended).toBe(false);
    expect(result.suggestionIds.length).toBeGreaterThanOrEqual(1);
    const pending = await listPendingMemorySuggestions(ws, { scope: "matter" });
    expect(pending.some((p) => p.kind === "case.progress")).toBe(true);
    const summaryPath = path.join(ws, "cases", "matter-distill", "session-summary.md");
    expect(fs.existsSync(summaryPath)).toBe(false);
  });

  it("does not duplicate pending preference suggestions on re-distill", async () => {
    const ws = tmpDir();
    const audit = path.join(ws, "audit");
    fs.mkdirSync(audit, { recursive: true });
    const session = createSession({ workspaceDir: ws, actorId: "lawyer-1" });
    const source = [
      {
        role: "user" as const,
        content: "以后请默认用正式书面语气回复，不要口语。",
        timestamp: new Date().toISOString(),
      },
    ];
    const first = await distillCompactIntoMemorySuggestions({
      workspaceDir: ws,
      auditDir: audit,
      session,
      sourceMessages: source,
    });
    const second = await distillCompactIntoMemorySuggestions({
      workspaceDir: ws,
      auditDir: audit,
      session,
      sourceMessages: source,
    });
    expect(first.suggestionIds.length).toBeGreaterThanOrEqual(1);
    expect(second.suggestionIds.length).toBe(0);
    const pending = await listPendingMemorySuggestions(ws, { scope: "lawyer" });
    const prefs = pending.filter((p) => p.kind === "lawyer.profile_learning");
    expect(prefs.length).toBe(first.suggestionIds.length);
  });
});
