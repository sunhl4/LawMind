import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listMemorySuggestions } from "../memory/adoption-service.js";
import { createSourceAnnotation, listSourceAnnotations } from "./source-annotation.js";

describe("source-annotation", () => {
  it("creates annotation and optional learning suggestion", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-annot-"));
    const row = await createSourceAnnotation(ws, path.join(ws, "audit"), {
      sourceId: "s-1",
      taskId: "task-a",
      matterId: "m-1",
      comment: "条款需复核",
      createLearning: true,
    });
    expect(row.id).toBeTruthy();
    const listed = listSourceAnnotations(ws, { sourceId: "s-1", taskId: "task-a" });
    expect(listed).toHaveLength(1);
    const pending = await listMemorySuggestions(ws, { state: "pending", scope: "matter" });
    expect(pending.some((p) => p.kind === "source.annotation")).toBe(true);
  });
});
