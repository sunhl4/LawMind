import { describe, expect, it } from "vitest";
import { conflictSidecarRelPath, lastWriteWinner } from "./last-write.js";

describe("replica last-write", () => {
  it("picks the later updatedAt", () => {
    const older = { sha256: "aaa", updatedAt: "2026-09-17T01:00:00.000Z" };
    const newer = { sha256: "bbb", updatedAt: "2026-09-17T02:00:00.000Z" };
    expect(lastWriteWinner(older, newer)).toBe(newer);
    expect(lastWriteWinner(newer, older)).toBe(newer);
  });

  it("ties on equal time with lexicographic sha256", () => {
    const a = { sha256: "aaa", updatedAt: "2026-09-17T01:00:00.000Z" };
    const b = { sha256: "bbb", updatedAt: "2026-09-17T01:00:00.000Z" };
    expect(lastWriteWinner(a, b)).toBe(b);
  });

  it("names a unique 冲突 sidecar", () => {
    const taken = new Set(["materials/合同.docx", "materials/合同 (冲突).docx"]);
    expect(conflictSidecarRelPath("materials/合同.docx", taken)).toBe(
      "materials/合同 (冲突 2).docx",
    );
  });
});
