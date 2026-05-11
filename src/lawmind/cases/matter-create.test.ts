import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMatterIfAbsent } from "./matter-create.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-matter-create-"));
}

describe("createMatterIfAbsent", () => {
  it("creates CASE.md once and reports created", async () => {
    const ws = tmpWs();
    const r1 = await createMatterIfAbsent(ws, "matter-alpha");
    expect(r1.created).toBe(true);
    expect(fs.existsSync(r1.caseFilePath)).toBe(true);
    const r2 = await createMatterIfAbsent(ws, "matter-alpha");
    expect(r2.created).toBe(false);
  });

  it("writes display name into CASE.md when provided", async () => {
    const ws = tmpWs();
    const r = await createMatterIfAbsent(ws, "matter-dn", { displayName: "房屋租赁案" });
    expect(r.created).toBe(true);
    const raw = fs.readFileSync(r.caseFilePath, "utf8");
    expect(raw).toContain("案件名称（展示用）: 房屋租赁案");
  });

  it("throws on invalid matter id", async () => {
    const ws = tmpWs();
    await expect(createMatterIfAbsent(ws, "..")).rejects.toThrow(/invalid/);
  });
});
