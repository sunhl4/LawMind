import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeWorkspaceStorageHealth } from "./workspace-storage-health.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-storage-health-"));
  dirs.push(dir);
  return dir;
}

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

describe("workspace storage health", () => {
  it("says so when the workspace has no case/session/draft data", () => {
    const health = summarizeWorkspaceStorageHealth(workspace());
    expect(health.ok).toBe(true);
    expect(health.lines[0]).toContain("还没有案件/会话/草稿数据");
  });

  it("counts cases, audit, sessions and drafts", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "{}");
    write(root, "cases/m2/matter.json", "{}");
    write(root, "audit/2026-10-28.jsonl", "12345");
    write(root, "sessions/s1.json", "1234567890");
    write(root, "sessions/s1.turns.jsonl", "12345");
    write(root, "drafts/t1.json", "123");
    const health = summarizeWorkspaceStorageHealth(root);
    expect(health.ok).toBe(true);
    const byName = new Map(health.buckets.map((bucket) => [bucket.name, bucket]));
    expect(byName.get("cases")?.directories).toBe(2);
    expect(byName.get("audit")?.bytes).toBe(5);
    expect(byName.get("sessions")?.files).toBe(2);
    expect(byName.get("drafts")?.bytes).toBe(3);
    expect(health.lines[0]).toContain("案件 2 个");
    expect(health.lines[0]).toContain("会话");
  });

  it("warns with a rotation suggestion when a threshold is crossed", () => {
    const root = workspace();
    write(root, "sessions/s1.json", "0123456789");
    write(root, "audit/2026-10-28.jsonl", "0123456789");
    write(root, "drafts/t1.json", "0123456789");
    const health = summarizeWorkspaceStorageHealth(root, {
      sessionWarnBytes: 5,
      auditWarnBytes: 5,
      draftWarnBytes: 5,
      caseWarnCount: 0,
    });
    expect(health.ok).toBe(false);
    expect(health.warnings).toHaveLength(3);
    expect(health.lines.join("\n")).toContain("建议归档旧会话");
    expect(health.lines.join("\n")).toContain("审计");
    expect(health.lines.join("\n")).toContain("草稿");
  });

  it("skips symlinks instead of following them", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "{}");
    const outside = workspace();
    write(outside, "big.json", "0123456789");
    fs.mkdirSync(path.join(root, "drafts"), { recursive: true });
    try {
      fs.symlinkSync(path.join(outside, "big.json"), path.join(root, "drafts", "link.json"));
    } catch {
      return;
    }
    const health = summarizeWorkspaceStorageHealth(root);
    const drafts = health.buckets.find((bucket) => bucket.name === "drafts");
    expect(drafts?.bytes).toBe(0);
    expect(drafts?.files).toBe(0);
  });

  it("counts the whole workspace but skips build and cache directories", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "{}");
    write(root, "matters/m1/matter.json", "1234");
    write(root, "node_modules/pkg/index.js", "0123456789");
    write(root, "tmp/scratch.bin", "0123456789");
    const health = summarizeWorkspaceStorageHealth(root);
    expect(health.totalBytes).toBe(6);
    expect(health.totalFiles).toBe(2);
  });

  it("reports quota usage without warning below the warn ratio", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "0123456789");
    const health = summarizeWorkspaceStorageHealth(root, {}, { quotaBytes: 100, warnRatio: 0.9 });
    expect(health.ok).toBe(true);
    expect(health.quota?.usedRatio).toBeCloseTo(0.1);
    expect(health.quota?.exceeded).toBe(false);
    expect(health.lines.join("\n")).toContain("配额 100 B，已用 10%");
  });

  it("warns when usage reaches the quota warn ratio", () => {
    const root = workspace();
    write(root, "cases/m1/matter.json", "0123456789");
    const health = summarizeWorkspaceStorageHealth(root, {}, { quotaBytes: 11, warnRatio: 0.9 });
    expect(health.ok).toBe(false);
    expect(health.warnings.join("\n")).toContain("达到配额");
    expect(health.warnings.join("\n")).toContain("storage.quotaGb");
  });

  it("says when the quota is exceeded and that writes are not blocked", () => {
    const root = workspace();
    write(root, "drafts/t1.json", "0123456789");
    const health = summarizeWorkspaceStorageHealth(root, {}, { quotaBytes: 5 });
    expect(health.quota?.exceeded).toBe(true);
    expect(health.warnings.join("\n")).toContain("超过配额");
    expect(health.warnings.join("\n")).toContain("不会拦住写入");
  });
});
