import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matterRequiredResult } from "./matter-required.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("matterRequiredResult", () => {
  it("returns needsMatter with empty matters when no cases", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matter-req-"));
    dirs.push(ws);
    const r = await matterRequiredResult(ws);
    expect(r.ok).toBe(false);
    expect(r.needsMatter).toBe(true);
    expect(r.matters).toEqual([]);
    expect(r.message).toContain("新建案件");
  });
});
