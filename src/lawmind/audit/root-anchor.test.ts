import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../types.js";
import {
  attachHashChain,
  resetAuditHashChainStateForTests,
  type AuditEventWithIntegrity,
} from "./hash-chain.js";
import {
  appendAuditRootAnchor,
  auditRootAnchorPath,
  latestAuditRootAnchor,
  readAuditRootAnchors,
  verifyAuditFileWithAnchor,
  verifyAuditWorkspaceTailAnchors,
} from "./root-anchor.js";

const tmpDirs: string[] = [];

function mkAuditDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-anchor-"));
  tmpDirs.push(dir);
  return dir;
}

function baseEvent(i: number): AuditEvent {
  return {
    eventId: `e${i}`,
    taskId: `t${i}`,
    kind: "task.created",
    actor: "system",
    timestamp: `2026-05-20T10:00:0${i}.000Z`,
    detail: `detail-${i}`,
  };
}

/** 模拟 emit 落盘路径：attach + append + 外锚（与 audit/index.ts 临界区同序）。 */
function appendChained(auditDir: string, date: string, event: AuditEvent): AuditEventWithIntegrity {
  const filePath = path.join(auditDir, `${date}.jsonl`);
  const stored = attachHashChain(filePath, event);
  fs.appendFileSync(filePath, `${JSON.stringify(stored)}\n`, "utf8");
  if (stored.eventHash) {
    appendAuditRootAnchor(auditDir, { date, rootHash: stored.eventHash, eventId: stored.eventId });
  }
  return stored;
}

beforeEach(() => {
  resetAuditHashChainStateForTests();
});

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("audit root anchor", () => {
  it("appends append-only anchor entries with timestamp", () => {
    const auditDir = mkAuditDir();
    const e0 = appendChained(auditDir, "2026-08-01", baseEvent(0));
    const e1 = appendChained(auditDir, "2026-08-01", baseEvent(1));
    const anchors = readAuditRootAnchors(auditDir);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].rootHash).toBe(e0.eventHash);
    expect(anchors[1].rootHash).toBe(e1.eventHash);
    expect(typeof anchors[0].timestamp).toBe("string");
    expect(latestAuditRootAnchor(auditDir, "2026-08-01")?.rootHash).toBe(e1.eventHash);
    expect(auditRootAnchorPath(auditDir)).toBe(path.join(auditDir, "audit-root.log"));
  });

  it("verifyAuditFileWithAnchor passes for an intact chain", () => {
    const auditDir = mkAuditDir();
    appendChained(auditDir, "2026-08-01", baseEvent(0));
    appendChained(auditDir, "2026-08-01", baseEvent(1));
    const result = verifyAuditFileWithAnchor(path.join(auditDir, "2026-08-01.jsonl"));
    expect(result.ok).toBe(true);
    expect(result.chainedCount).toBe(2);
    expect(result.tailTruncationSuspected).toBe(false);
    expect(result.anchor?.rootHash).toBeTruthy();
  });

  it("detects tail truncation by comparing against the anchor", () => {
    const auditDir = mkAuditDir();
    appendChained(auditDir, "2026-08-01", baseEvent(0));
    appendChained(auditDir, "2026-08-01", baseEvent(1));
    appendChained(auditDir, "2026-08-01", baseEvent(2));
    const filePath = path.join(auditDir, "2026-08-01.jsonl");
    // 截掉最后一条（尾部截断）：链本身仍连续，但外锚根哈希对不上。
    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(filePath, `${lines.slice(0, 2).join("\n")}\n`, "utf8");

    const result = verifyAuditFileWithAnchor(filePath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("anchor_mismatch");
    expect(result.tailTruncationSuspected).toBe(true);
    expect(result.chainedCount).toBe(2);

    const workspace = verifyAuditWorkspaceTailAnchors(auditDir);
    expect(workspace.ok).toBe(false);
    expect(workspace.truncatedDays).toEqual(["2026-08-01"]);
    expect(workspace.checkedDays).toBe(1);
  });

  it("detects deletion of the whole day file when an anchor exists", () => {
    const auditDir = mkAuditDir();
    appendChained(auditDir, "2026-08-01", baseEvent(0));
    fs.rmSync(path.join(auditDir, "2026-08-01.jsonl"));
    const result = verifyAuditFileWithAnchor(path.join(auditDir, "2026-08-01.jsonl"));
    expect(result.ok).toBe(false);
    expect(result.tailTruncationSuspected).toBe(true);
  });

  it("detects mid-chain tampering before anchor comparison", () => {
    const auditDir = mkAuditDir();
    appendChained(auditDir, "2026-08-01", baseEvent(0));
    appendChained(auditDir, "2026-08-01", baseEvent(1));
    const filePath = path.join(auditDir, "2026-08-01.jsonl");
    const events = fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditEventWithIntegrity);
    events[0] = { ...events[0], detail: "篡改历史" };
    fs.writeFileSync(filePath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
    const result = verifyAuditFileWithAnchor(filePath);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("hash_mismatch");
    expect(result.tailTruncationSuspected).toBe(false);
  });

  it("skips days without anchors (legacy files stay out of scope)", () => {
    const auditDir = mkAuditDir();
    // legacy 日文件：有链记录但无外锚。
    const filePath = path.join(auditDir, "2026-07-01.jsonl");
    const e0 = attachHashChain(filePath, baseEvent(0), { key: null });
    fs.appendFileSync(filePath, `${JSON.stringify(e0)}\n`, "utf8");
    const workspace = verifyAuditWorkspaceTailAnchors(auditDir);
    expect(workspace.ok).toBe(true);
    expect(workspace.checkedDays).toBe(0);
  });
});
