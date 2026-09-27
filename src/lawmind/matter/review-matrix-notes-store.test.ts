import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReviewMatrixNotes, writeReviewMatrixNotes } from "./review-matrix-notes-store.js";

describe("review matrix notes store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("round-trips notes in the matter directory", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matrix-notes-"));
    dirs.push(workspaceDir);
    const saved = writeReviewMatrixNotes(workspaceDir, "m1", {
      notes: { "doc::q1": "核对过当事人" },
      verified: { "doc::q1": true, "doc::q2": false },
    });
    expect(saved.verified["doc::q2"]).toBeUndefined();
    const loaded = readReviewMatrixNotes(workspaceDir, "m1");
    expect(loaded.notes["doc::q1"]).toBe("核对过当事人");
    expect(loaded.verified["doc::q1"]).toBe(true);
    expect(readReviewMatrixNotes(workspaceDir, "missing").notes).toEqual({});
  });
});
