import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addScanRoot, listScanRoots, removeScanRoot } from "./job-store.js";
import { MAX_SCAN_ROOTS } from "./types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("historical-scan job-store", () => {
  it("allows up to three roots and rejects the fourth", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-roots-ws-"));
    dirs.push(ws);
    for (let i = 0; i < MAX_SCAN_ROOTS; i += 1) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `lm-root-${i}-`));
      dirs.push(root);
      const added = addScanRoot(ws, root, `根${i + 1}`);
      expect(added.ok).toBe(true);
    }
    const extra = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root-extra-"));
    dirs.push(extra);
    const fourth = addScanRoot(ws, extra, "第四");
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.error).toBe("max_roots");
    }
    expect(listScanRoots(ws)).toHaveLength(3);
  });

  it("removes a root by id", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-roots-rm-"));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root-rm-"));
    dirs.push(ws, root);
    const added = addScanRoot(ws, root, "可删");
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(removeScanRoot(ws, added.root.id)).toBe(true);
    expect(listScanRoots(ws)).toEqual([]);
    expect(removeScanRoot(ws, added.root.id)).toBe(false);
  });
});
