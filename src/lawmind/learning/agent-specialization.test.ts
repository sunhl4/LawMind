import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  firstPassRate,
  loadAgentSpecializationStore,
  recordAgentReviewOutcome,
} from "./agent-specialization.js";

describe("agent-specialization", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records first-pass and rewrite rates", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-spec-"));
    recordAgentReviewOutcome({ workspaceDir: dir, assistantId: "a1", firstPass: true });
    recordAgentReviewOutcome({ workspaceDir: dir, assistantId: "a1", firstPass: false });
    const store = loadAgentSpecializationStore(dir);
    const s = store.byAssistant.a1;
    expect(s.tasksReviewed).toBe(2);
    expect(s.firstPassApprovals).toBe(1);
    expect(firstPassRate(s)).toBe(0.5);
  });
});
