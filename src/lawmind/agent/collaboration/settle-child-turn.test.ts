import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, loadSession, saveSession } from "../session.js";
import {
  getDelegation,
  markDelegationAwaitingLawyer,
  registerDelegation,
} from "./delegation-registry.js";
import { settleCollaborationChildTurn } from "./settle-child-turn.js";

describe("settleCollaborationChildTurn", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("closes a waiting delegation and writes the result back to the host chat", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-settle-"));
    dirs.push(root);
    const workspaceDir = path.join(root, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const parent = createSession({ workspaceDir, actorId: "lawyer", title: "主办" });
    saveSession(workspaceDir, parent);
    const record = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "contracts",
      task: "改管辖条款",
      parentSessionId: parent.sessionId,
    });
    markDelegationAwaitingLawyer(workspaceDir, record.delegationId, "等你确认");
    const child = createSession({ workspaceDir, actorId: "contracts", title: "协作·交办" });
    child.collaborationDelegationId = record.delegationId;
    child.omitFromChatSwitcher = true;
    saveSession(workspaceDir, child);

    settleCollaborationChildTurn({
      workspaceDir,
      sessionId: child.sessionId,
      status: "completed",
      reply: "修订稿已写入",
    });

    expect(getDelegation(record.delegationId)?.status).toBe("completed");
    expect(getDelegation(record.delegationId)?.result).toContain("修订稿已写入");
    const host = loadSession(workspaceDir, parent.sessionId);
    expect(host?.conversationHistory.at(-1)?.content).toContain("修订稿已写入");
  });
});
