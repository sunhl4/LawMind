import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertAssistant } from "../assistants/store.js";
import {
  effectiveForcePeerReview,
  loadRoutingDefaults,
  resolveDefaultAssignee,
  saveRoutingDefaults,
} from "./defaults.js";

describe("routing/defaults", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves explicit assistant over table", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-routing-"));
    const r = resolveDefaultAssignee({
      workspaceDir: dir,
      kind: "contract.review",
      explicitAssistantId: "picked",
      fallbackAssistantId: "shell",
    });
    expect(r).toEqual({ assistantId: "picked", source: "explicit" });
  });

  it("resolves by roleId when assistant exists", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-routing-"));
    const ws = path.join(dir, "workspace");
    fs.mkdirSync(ws, { recursive: true });
    upsertAssistant(dir, {
      assistantId: "asst_c",
      displayName: "合同",
      introduction: "x",
      roleId: "contract_review",
      presetKey: "contract_review",
    });
    saveRoutingDefaults(ws, {
      version: 1,
      forcePeerReview: null,
      byKind: { "contract.review": { roleId: "contract_review" } },
      byDeliverableType: {},
    });
    const r = resolveDefaultAssignee({
      workspaceDir: ws,
      kind: "contract.review",
      fallbackAssistantId: "shell",
    });
    expect(r.assistantId).toBe("asst_c");
    expect(r.source).toBe("roleId");
  });

  it("falls back when role has no assistant", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-routing-"));
    saveRoutingDefaults(dir, {
      version: 1,
      byKind: { "contract.review": { roleId: "contract_review" } },
    });
    const r = resolveDefaultAssignee({
      workspaceDir: dir,
      kind: "contract.review",
      fallbackAssistantId: "shell",
    });
    expect(r).toMatchObject({ assistantId: "shell", source: "fallback" });
  });

  it("forcePeerReview respects workspace override over edition", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-routing-"));
    saveRoutingDefaults(dir, { version: 1, forcePeerReview: true });
    expect(effectiveForcePeerReview({ workspaceDir: dir, env: { LAWMIND_EDITION: "solo" } })).toBe(
      true,
    );
    saveRoutingDefaults(dir, { version: 1, forcePeerReview: false });
    expect(effectiveForcePeerReview({ workspaceDir: dir, env: { LAWMIND_EDITION: "firm" } })).toBe(
      false,
    );
    saveRoutingDefaults(dir, { version: 1, forcePeerReview: null });
    expect(effectiveForcePeerReview({ workspaceDir: dir, env: { LAWMIND_EDITION: "firm" } })).toBe(
      true,
    );
    expect(effectiveForcePeerReview({ workspaceDir: dir, env: { LAWMIND_EDITION: "solo" } })).toBe(
      false,
    );
  });

  it("save/load roundtrip", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-routing-"));
    saveRoutingDefaults(dir, {
      version: 1,
      forcePeerReview: true,
      byKind: { x: { assistantId: "a1" } },
    });
    const loaded = loadRoutingDefaults(dir);
    expect(loaded.forcePeerReview).toBe(true);
    expect(loaded.byKind?.x?.assistantId).toBe("a1");
  });
});
