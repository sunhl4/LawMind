import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetAuditHashChainStateForTests } from "./hash-chain.js";
import { emit, readAuditLog, resolveDefaultAuditIntegrityChain } from "./index.js";

describe("emit default integrityChain", () => {
  const prev = process.env.LAWMIND_EDITION;

  afterEach(() => {
    resetAuditHashChainStateForTests();
    if (prev === undefined) {
      delete process.env.LAWMIND_EDITION;
    } else {
      process.env.LAWMIND_EDITION = prev;
    }
  });

  it("enables chain for firm edition by default", async () => {
    process.env.LAWMIND_EDITION = "firm";
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-firm-"));
    const auditDir = path.join(ws, "audit");
    expect(resolveDefaultAuditIntegrityChain(auditDir)).toBe(true);
    await emit(auditDir, { taskId: "t1", kind: "task.created", actor: "system" });
    const events = await readAuditLog(auditDir);
    expect(events[0] && "eventHash" in events[0]).toBe(true);
  });

  it("skips chain when integrityChain false", async () => {
    process.env.LAWMIND_EDITION = "firm";
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-off-"));
    const auditDir = path.join(ws, "audit");
    await emit(auditDir, {
      taskId: "t2",
      kind: "task.created",
      actor: "system",
      integrityChain: false,
    });
    const events = await readAuditLog(auditDir);
    expect(events[0] && "eventHash" in (events[0] as object)).toBe(false);
  });
});
