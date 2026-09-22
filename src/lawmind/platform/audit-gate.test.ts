import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitPlatformGateSnapshot,
  listPlatformGateHistory,
  parsePlatformGateSnapshotDetail,
  PLATFORM_GATE_AUDIT_KIND,
} from "./audit-gate.js";

describe("platform/audit-gate", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips snapshot detail JSON", () => {
    const detail = JSON.stringify({
      v: 1,
      source: "review",
      executionState: { phase: "approval", status: "awaiting_approval", recoverable: true },
      gateDecisions: [{ gate: "approval_gate", decision: "awaiting_confirmation" }],
    });
    const parsed = parsePlatformGateSnapshotDetail(detail);
    expect(parsed?.source).toBe("review");
    expect(parsed?.gateDecisions?.[0]?.gate).toBe("approval_gate");
  });

  it("emitPlatformGateSnapshot persists and listPlatformGateHistory returns newest first", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-audit-gate-"));
    tempDirs.push(ws);
    const auditDir = path.join(ws, "audit");
    await emitPlatformGateSnapshot(auditDir, {
      taskId: "task-a",
      source: "review",
      actor: "lawyer",
      executionState: {
        phase: "approval",
        status: "awaiting_approval",
        recoverable: true,
      },
      gateDecisions: [{ gate: "approval_gate", decision: "awaiting_confirmation" }],
    });
    await emitPlatformGateSnapshot(auditDir, {
      taskId: "task-b",
      source: "render",
      actor: "lawyer",
      executionState: { phase: "complete", status: "completed", recoverable: false },
      gateDecisions: [{ gate: "acceptance_gate", decision: "allow" }],
    });
    const rows = await listPlatformGateHistory(ws, 10);
    expect(rows.length).toBe(2);
    expect(rows[0]?.taskId).toBe("task-b");
    expect(rows[0]?.source).toBe("render");
    expect(rows[1]?.taskId).toBe("task-a");
    expect(PLATFORM_GATE_AUDIT_KIND).toBe("platform.gate_snapshot");
  });
});
