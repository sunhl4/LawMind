import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendClausePlaybookLearning,
  buildClausePlaybookReviewLine,
  reviewLabelsTriggerPlaybook,
} from "./playbook-learning.js";

describe("playbook-learning", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("reviewLabelsTriggerPlaybook matches trigger labels only", () => {
    expect(reviewLabelsTriggerPlaybook(["citation.incomplete"])).toBe(true);
    expect(reviewLabelsTriggerPlaybook(["tone.too_strong"])).toBe(false);
    expect(reviewLabelsTriggerPlaybook(["tone.too_strong", "issue.missing"])).toBe(true);
  });

  it("buildClausePlaybookReviewLine filters to trigger labels", () => {
    const line = buildClausePlaybookReviewLine(
      "t-1",
      ["citation.incomplete", "tone.too_strong"],
      "fix refs",
    );
    expect(line).toContain("t-1");
    expect(line).toContain("citation.incomplete");
    expect(line).not.toContain("tone.too_strong");
    expect(line).toContain("fix refs");
  });

  it("appendClausePlaybookLearning creates file and section with bullet", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-playbook-"));
    await appendClausePlaybookLearning(tmp, "任务 x；labels=citation.incomplete");
    const raw = await fs.readFile(path.join(tmp, "playbooks", "CLAUSE_PLAYBOOK.md"), "utf8");
    expect(raw).toContain("## 6. LawMind 审核学习（自动摘要）");
    expect(raw).toContain("- [");
    expect(raw).toContain("citation.incomplete");
  });

  it("appendClausePlaybookLearning inserts into existing section 6", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-playbook-"));
    const p = path.join(tmp, "playbooks", "CLAUSE_PLAYBOOK.md");
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(
      p,
      ["# T", "", "## 6. LawMind 审核学习（自动摘要）", "", "- [old] first", ""].join("\n"),
      "utf8",
    );
    await appendClausePlaybookLearning(tmp, "second line");
    const raw = await fs.readFile(p, "utf8");
    expect(raw).toContain("first");
    expect(raw).toContain("second line");
  });
});
