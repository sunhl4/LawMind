import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDrafts, persistDraft } from "./index.js";

describe("listDrafts", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("skips outline sidecars and missing createdAt", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-drafts-list-"));
    tmp.push(workspaceDir);
    persistDraft(workspaceDir, {
      taskId: "t1",
      matterId: "m1",
      title: "起诉状",
      output: "docx",
      templateId: "x",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    fs.writeFileSync(
      path.join(workspaceDir, "drafts", "orphan.outline.json"),
      JSON.stringify({ title: "outline only" }),
      "utf8",
    );
    const listed = listDrafts(workspaceDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe("起诉状");
  });
});
