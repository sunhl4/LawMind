import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistDraft, readDraft } from "../drafts/index.js";
import { ensureTaskRecord, readTaskRecord, updateTaskRecord } from "../tasks/index.js";
import { getDelegation, registerDelegation } from "./collaboration/delegation-registry.js";
import { beginLiveTurnProgress, getLiveTurnProgress } from "./live-turn-progress.js";
import { deleteSessionWithCascade } from "./session-delete-cascade.js";
import { createSession, loadSession } from "./session.js";

describe("deleteSessionWithCascade", () => {
  let ws: string;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-session-cascade-"));
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("always removes session json, turns, transcript, and live-turn", () => {
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    const sid = s.sessionId;
    fs.writeFileSync(path.join(ws, "sessions", `${sid}.turns.jsonl`), "{}\n", "utf8");
    fs.writeFileSync(path.join(ws, "sessions", `${sid}.transcript.jsonl`), "{}\n", "utf8");
    beginLiveTurnProgress(sid);

    const r = deleteSessionWithCascade(ws, sid);
    expect(r.deletedSession).toBe(true);
    expect(r.deletedTranscript).toBe(true);
    expect(loadSession(ws, sid)).toBeUndefined();
    expect(fs.existsSync(path.join(ws, "sessions", `${sid}.transcript.jsonl`))).toBe(false);
    expect(getLiveTurnProgress(sid)).toBeUndefined();
  });

  it("cascadeDelegations removes child session and delegation record", () => {
    const parent = createSession({ workspaceDir: ws, actorId: "a" });
    const child = createSession({ workspaceDir: ws, actorId: "a" });
    const del = registerDelegation({
      workspaceDir: ws,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "调研",
      parentSessionId: parent.sessionId,
      targetSessionId: child.sessionId,
    });

    const r = deleteSessionWithCascade(ws, parent.sessionId, { cascadeDelegations: true });
    expect(r.cancelledDelegations).toBe(1);
    expect(r.deletedChildSessions).toBe(1);
    expect(loadSession(ws, parent.sessionId)).toBeUndefined();
    expect(loadSession(ws, child.sessionId)).toBeUndefined();
    expect(getDelegation(del.delegationId)).toBeUndefined();
    expect(fs.existsSync(path.join(ws, "delegations", `${del.delegationId}.json`))).toBe(false);
  });

  it("cascadeUnapprovedDrafts deletes pending draft but keeps approved", () => {
    const s = createSession({ workspaceDir: ws, actorId: "a" });
    const pendingId = "draft-pending";
    const approvedId = "draft-approved";
    for (const taskId of [pendingId, approvedId]) {
      ensureTaskRecord(ws, {
        taskId,
        kind: "draft.word",
        output: "docx",
        instruction: "写",
        summary: "写",
        riskLevel: "medium",
        models: ["general"],
        requiresConfirmation: false,
        createdAt: new Date().toISOString(),
      });
      updateTaskRecord(ws, taskId, { sessionId: s.sessionId });
    }
    persistDraft(ws, {
      taskId: pendingId,
      title: "待审",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    persistDraft(ws, {
      taskId: approvedId,
      title: "已过",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    const r = deleteSessionWithCascade(ws, s.sessionId, { cascadeUnapprovedDrafts: true });
    expect(r.deletedDrafts).toBe(1);
    expect(r.deletedTasks).toBe(1);
    expect(readDraft(ws, pendingId)).toBeUndefined();
    expect(readTaskRecord(ws, pendingId)).toBeUndefined();
    expect(readDraft(ws, approvedId)?.reviewStatus).toBe("approved");
    expect(readTaskRecord(ws, approvedId)).toBeDefined();
  });

  it("cascadeDelegations recurses into grandchild sessions and their drafts", () => {
    const parent = createSession({ workspaceDir: ws, actorId: "a" });
    const child = createSession({ workspaceDir: ws, actorId: "a" });
    const grandchild = createSession({ workspaceDir: ws, actorId: "a" });
    const del1 = registerDelegation({
      workspaceDir: ws,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "一级委派",
      parentSessionId: parent.sessionId,
      targetSessionId: child.sessionId,
    });
    const del2 = registerDelegation({
      workspaceDir: ws,
      fromAssistantId: "research",
      toAssistantId: "writer",
      task: "二级委派（孙）",
      parentSessionId: child.sessionId,
      targetSessionId: grandchild.sessionId,
    });
    // 孙会话绑定一条未受保护草稿。
    ensureTaskRecord(ws, {
      taskId: "grandchild-draft",
      kind: "draft.word",
      output: "docx",
      instruction: "写",
      summary: "写",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    });
    updateTaskRecord(ws, "grandchild-draft", { sessionId: grandchild.sessionId });
    persistDraft(ws, {
      taskId: "grandchild-draft",
      title: "孙草稿",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });

    const r = deleteSessionWithCascade(ws, parent.sessionId, {
      cascadeDelegations: true,
      cascadeUnapprovedDrafts: true,
    });
    expect(r.cancelledDelegations).toBe(2);
    expect(r.deletedChildSessions).toBe(2);
    expect(r.deletedDrafts).toBe(1);
    expect(loadSession(ws, parent.sessionId)).toBeUndefined();
    expect(loadSession(ws, child.sessionId)).toBeUndefined();
    expect(loadSession(ws, grandchild.sessionId)).toBeUndefined();
    expect(getDelegation(del1.delegationId)).toBeUndefined();
    expect(getDelegation(del2.delegationId)).toBeUndefined();
    expect(readDraft(ws, "grandchild-draft")).toBeUndefined();
  });

  it("without cascade flags leaves drafts and delegations", () => {
    const parent = createSession({ workspaceDir: ws, actorId: "a" });
    const child = createSession({ workspaceDir: ws, actorId: "a" });
    const del = registerDelegation({
      workspaceDir: ws,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "调研",
      parentSessionId: parent.sessionId,
      targetSessionId: child.sessionId,
    });
    ensureTaskRecord(ws, {
      taskId: "keep-draft",
      kind: "draft.word",
      output: "docx",
      instruction: "写",
      summary: "写",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: new Date().toISOString(),
    });
    updateTaskRecord(ws, "keep-draft", { sessionId: parent.sessionId });
    persistDraft(ws, {
      taskId: "keep-draft",
      title: "保留",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });

    deleteSessionWithCascade(ws, parent.sessionId);
    expect(loadSession(ws, parent.sessionId)).toBeUndefined();
    expect(loadSession(ws, child.sessionId)).toBeDefined();
    expect(getDelegation(del.delegationId)).toBeDefined();
    expect(readDraft(ws, "keep-draft")).toBeDefined();
  });
});
