import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDelegations } from "../agent/collaboration/delegation-registry.js";
import { upsertAssistant } from "../assistants/store.js";
import type { ArtifactDraft } from "../types.js";
import { saveRoutingDefaults } from "./defaults.js";
import { maybeApplyForcedPeerReview } from "./peer-review-gate.js";

describe("peer-review-gate", () => {
  let root: string;
  let ws: string;

  afterEach(() => {
    if (!root) {
      return;
    }
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // Linux CI can hit ENOTEMPTY while SQLite/fs handles are still closing; tmp is disposable.
    }
  });

  it("registers peer delegation when force on and peer configured", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peer-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    upsertAssistant(root, {
      assistantId: "peer",
      displayName: "互审",
      introduction: "",
      roleId: "general_default",
    });
    upsertAssistant(root, {
      assistantId: "author",
      displayName: "作者",
      introduction: "",
      roleId: "contract_review",
      peerReviewDefaultAssistantId: "peer",
    });
    saveRoutingDefaults(ws, { version: 1, forcePeerReview: true });
    const draft: ArtifactDraft = {
      taskId: "t-peer-1",
      matterId: "m1",
      title: "审查意见",
      summary: "s",
      sections: [],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    const r = maybeApplyForcedPeerReview({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      draft,
      authorAssistantId: "author",
    });
    expect(r.applied).toBe(true);
    expect(r.peerAssistantId).toBe("peer");
    const dels = listDelegations({ toAssistantId: "peer" });
    expect(dels.length).toBeGreaterThanOrEqual(1);
  });

  it("skips when force off", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peer-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    saveRoutingDefaults(ws, { version: 1, forcePeerReview: false });
    const draft: ArtifactDraft = {
      taskId: "t-peer-2",
      title: "x",
      summary: "s",
      sections: [],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    const r = maybeApplyForcedPeerReview({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      draft,
      authorAssistantId: "author",
    });
    expect(r.applied).toBe(false);
    expect(r.skippedReason).toBe("edition_off");
  });

  it("skips when author missing", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peer-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    saveRoutingDefaults(ws, { version: 1, forcePeerReview: true });
    const draft: ArtifactDraft = {
      taskId: "t-no-author",
      title: "x",
      summary: "s",
      sections: [],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    const r = maybeApplyForcedPeerReview({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      draft,
    });
    expect(r.applied).toBe(false);
    expect(r.skippedReason).toBe("no_author");
  });

  it("skips when author has no peer configured", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-peer-"));
    ws = path.join(root, "workspace");
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    upsertAssistant(root, {
      assistantId: "solo",
      displayName: "独作",
      introduction: "",
      roleId: "general_default",
    });
    saveRoutingDefaults(ws, { version: 1, forcePeerReview: true });
    const draft: ArtifactDraft = {
      taskId: "t-no-peer",
      title: "x",
      summary: "s",
      sections: [],
      reviewStatus: "pending",
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      createdAt: new Date().toISOString(),
    };
    const r = maybeApplyForcedPeerReview({
      workspaceDir: ws,
      auditDir: path.join(ws, "audit"),
      draft,
      authorAssistantId: "solo",
    });
    expect(r.applied).toBe(false);
    expect(r.skippedReason).toBe("no_peer");
  });
});