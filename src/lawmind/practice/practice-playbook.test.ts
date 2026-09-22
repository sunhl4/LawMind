import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_PLAYBOOK,
  formatPracticePlaybookPromptBlock,
  loadPracticePlaybook,
  savePracticePlaybook,
  shouldInjectPracticePlaybook,
} from "./practice-playbook.js";

describe("practice-playbook", () => {
  let ws: string;
  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("uses built-in defaults when the file is missing and never blocks", () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-playbook-"));
    const loaded = loadPracticePlaybook(ws);
    expect(loaded.source).toBe("default");
    expect(loaded.stanceDefault).toBe("protect_instructing");
    expect(formatPracticePlaybookPromptBlock(loaded)).toContain("开箱默认");
    expect(formatPracticePlaybookPromptBlock(loaded)).toContain("之后");
  });

  it("saves workspace overrides for later tasks only", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-playbook-"));
    const first = loadPracticePlaybook(ws);
    const saved = await savePracticePlaybook(ws, {
      stanceDefault: "our_paper",
      neverAccept: ["无限责任", "单方解约无补偿"],
    });
    expect(saved.source).toBe("workspace");
    expect(saved.stanceDefault).toBe("our_paper");
    expect(saved.updatedAt).toBeTruthy();
    const again = loadPracticePlaybook(ws);
    expect(again.stanceDefault).toBe("our_paper");
    expect(again.neverAccept).toContain("单方解约无补偿");
    expect(first.stanceDefault).toBe(DEFAULT_PRACTICE_PLAYBOOK.stanceDefault);
    expect(formatPracticePlaybookPromptBlock(again)).toContain("本工作区口径");
  });

  it("skips mail and Word tracked-redline so frozen paths stay intact", () => {
    expect(
      shouldInjectPracticePlaybook({ id: "contract.review", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(shouldInjectPracticePlaybook({ id: "mail.contract", pipeline: "tracked_redline" })).toBe(
      false,
    );
    expect(
      shouldInjectPracticePlaybook({ id: "contract.review", pipeline: "tracked_redline" }),
    ).toBe(false);
    expect(shouldInjectPracticePlaybook(null)).toBe(false);
  });
});
