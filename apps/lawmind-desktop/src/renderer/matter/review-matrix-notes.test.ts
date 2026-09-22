/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadReviewMatrixNotes,
  matrixCellKey,
  saveReviewMatrixNotes,
} from "./review-matrix-notes.js";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("review-matrix-notes", () => {
  const matterId = "matter-notes-test";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists notes and verified flags per matter", () => {
    vi.stubGlobal("localStorage", mockStorage());
    const key = matrixCellKey("file:CASE.md", "q-parties");
    saveReviewMatrixNotes(matterId, {
      notes: { [key]: "已核对当事人" },
      verified: { [key]: true },
    });
    const loaded = loadReviewMatrixNotes(matterId);
    expect(loaded.notes[key]).toBe("已核对当事人");
    expect(loaded.verified[key]).toBe(true);
  });
});
