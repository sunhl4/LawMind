import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareDocuments } from "./compare-documents.js";

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-compare-"));
}

describe("compare_documents", () => {
  it("reports identical text", async () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "a.txt"), "同一段\n", "utf8");
    fs.writeFileSync(path.join(ws, "b.txt"), "同一段\n", "utf8");
    const result = await compareDocuments.execute(
      { file_a: "a.txt", file_b: "b.txt" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    expect((result.data as { identical?: boolean }).identical).toBe(true);
  });

  it("reports added and removed lines without writing", async () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "old.txt"), "甲方\n价款一百\n", "utf8");
    fs.writeFileSync(path.join(ws, "new.txt"), "甲方\n价款二百\n", "utf8");
    const result = await compareDocuments.execute(
      { file_a: "old.txt", file_b: "new.txt" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { added?: number; removed?: number; identical?: boolean };
    expect(data.identical).toBe(false);
    expect(data.removed).toBeGreaterThan(0);
    expect(data.added).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(ws, "old.txt"), "utf8")).toBe("甲方\n价款一百\n");
  });

  it("rejects missing paths", async () => {
    const ws = tmpWorkspace();
    const result = await compareDocuments.execute(
      { file_a: "missing.txt", file_b: "also-missing.txt" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(false);
  });
});
