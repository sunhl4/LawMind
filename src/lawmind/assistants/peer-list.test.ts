import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerDelegation } from "../agent/collaboration/delegation-registry.js";
import {
  assistantIdsWithInboundBusyDelegations,
  buildPeerAssistantsForPrompt,
} from "./peer-list.js";
import { saveAssistantProfiles } from "./store.js";

describe("buildPeerAssistantsForPrompt", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("lists all assistants except current", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peers-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    dirs.push(lawMindRoot);
    const now = new Date().toISOString();
    saveAssistantProfiles(lawMindRoot, [
      {
        assistantId: "default",
        displayName: "默认助手",
        introduction: "",
        presetKey: "general_default",
        createdAt: now,
        updatedAt: now,
      },
      {
        assistantId: "esg-a",
        displayName: "ESG 专员",
        introduction: "",
        presetKey: "general_default",
        createdAt: now,
        updatedAt: now,
      },
      {
        assistantId: "eu-b",
        displayName: "欧盟合规",
        introduction: "",
        presetKey: "general_default",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const peers = buildPeerAssistantsForPrompt({
      lawMindRoot,
      workspaceDir,
      currentAssistantId: "default",
    });
    expect(peers.available.map((p) => p.id).toSorted()).toEqual(["esg-a", "eu-b"]);
    expect(peers.busy).toEqual([]);
  });

  it("marks inbound running delegation target as busy", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peers-busy-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    dirs.push(lawMindRoot);
    const now = new Date().toISOString();
    saveAssistantProfiles(lawMindRoot, [
      {
        assistantId: "a",
        displayName: "A",
        introduction: "",
        presetKey: "general_default",
        createdAt: now,
        updatedAt: now,
      },
      {
        assistantId: "b",
        displayName: "B",
        introduction: "",
        presetKey: "general_default",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    registerDelegation({
      workspaceDir,
      fromAssistantId: "a",
      toAssistantId: "b",
      task: "running subtask",
    });

    const busy = assistantIdsWithInboundBusyDelegations(workspaceDir);
    expect(busy.has("b")).toBe(true);

    const peers = buildPeerAssistantsForPrompt({
      lawMindRoot,
      workspaceDir,
      currentAssistantId: "a",
    });
    expect(peers.available.map((p) => p.id)).toEqual([]);
    expect(peers.busy.map((p) => p.id)).toEqual(["b"]);
  });
});
