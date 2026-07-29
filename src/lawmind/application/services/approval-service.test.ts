import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import {
  listPendingApprovals,
  listApprovals,
  requestApproval,
  resolveApproval,
  type ResolveApprovalResult,
} from "./approval-service.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(HERE, "approval-resolve-worker.mjs");

function resolveInChild(input: {
  workspaceDir: string;
  matterId: string;
  approvalId: string;
  status: "approved" | "rejected" | "needs_changes";
  resolvedBy: string;
}): Promise<ResolveApprovalResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        WORKER_PATH,
        input.workspaceDir,
        input.matterId,
        input.approvalId,
        input.status,
        input.resolvedBy,
      ],
      { cwd: path.resolve(HERE, "../../../.."), env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`approval child exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ResolveApprovalResult);
      } catch (e) {
        reject(new Error(`invalid child JSON: ${stdout}\n${stderr}\n${String(e)}`));
      }
    });
  });
}

describe("application/services/approval-service", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fsPromises.mkdtemp(path.join("/tmp", "lawmind-approval-svc-"));
    await fsPromises.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("request → list pending → resolve approve", () => {
    const created = requestApproval(workspaceDir, {
      matterId: "m-appr",
      requestedBy: "lawyer-1",
      reason: "高风险导出",
      riskLevel: "high",
      targetRole: "partner",
    });
    expect(created.status).toBe("pending");
    expect(created.approvalId).toBeTruthy();

    const pending = listPendingApprovals(workspaceDir, "m-appr", { targetRole: "partner" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.approvalId).toBe(created.approvalId);

    const resolved = resolveApproval(workspaceDir, "m-appr", created.approvalId, {
      status: "approved",
      resolvedBy: "lawyer-1",
    });
    expect(resolved).toMatchObject({ outcome: "written", approval: { status: "approved" } });
    expect(listPendingApprovals(workspaceDir, "m-appr")).toHaveLength(0);
  });

  it("CAS: second resolve returns already_resolved without flipping", () => {
    const created = requestApproval(workspaceDir, {
      matterId: "m-cas",
      requestedBy: "lawyer-1",
      reason: "并发签批",
      riskLevel: "medium",
    });

    const first = resolveApproval(workspaceDir, "m-cas", created.approvalId, {
      status: "approved",
      resolvedBy: "lawyer-a",
    });
    const second = resolveApproval(workspaceDir, "m-cas", created.approvalId, {
      status: "rejected",
      resolvedBy: "lawyer-b",
    });

    expect(first).toMatchObject({
      outcome: "written",
      approval: { status: "approved", resolvedBy: "lawyer-a" },
    });
    expect(second).toMatchObject({
      outcome: "already_resolved",
      approval: { status: "approved", resolvedBy: "lawyer-a" },
    });
    expect(listPendingApprovals(workspaceDir, "m-cas")).toHaveLength(0);
  });

  it("file lock times out while another holder keeps the lock file", () => {
    const lockPath = path.join(workspaceDir, "matters", "m-lock", "approvals.jsonl.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "", "utf8");
    expect(() =>
      withExclusiveFileLock(lockPath, () => "acquired", { timeoutMs: 40, pollMs: 5 }),
    ).toThrow(/file_lock_timeout/);
    fs.unlinkSync(lockPath);
    expect(withExclusiveFileLock(lockPath, () => "ok", { timeoutMs: 200, pollMs: 5 })).toBe("ok");
  });

  it("true concurrent resolve under lock: only one transition wins", async () => {
    const created = requestApproval(workspaceDir, {
      matterId: "m-race",
      requestedBy: "lawyer-1",
      reason: "竞态",
      riskLevel: "high",
    });

    const payloads = [
      { status: "approved" as const, resolvedBy: "lawyer-0" },
      { status: "rejected" as const, resolvedBy: "lawyer-1" },
      { status: "needs_changes" as const, resolvedBy: "lawyer-2" },
    ];

    const results = await Promise.all(
      payloads.map((p) =>
        resolveInChild({
          workspaceDir,
          matterId: "m-race",
          approvalId: created.approvalId,
          status: p.status,
          resolvedBy: p.resolvedBy,
        }),
      ),
    );

    const written = results.filter((r) => r.outcome === "written");
    const losers = results.filter((r) => r.outcome === "already_resolved");
    expect(written).toHaveLength(1);
    expect(losers).toHaveLength(2);

    const winnerStatus = written[0].approval.status;
    expect(["approved", "rejected", "needs_changes"]).toContain(winnerStatus);
    for (const loser of losers) {
      expect(loser.approval.status).toBe(winnerStatus);
      expect(loser.approval.resolvedBy).toBe(written[0].approval.resolvedBy);
    }
    expect(listPendingApprovals(workspaceDir, "m-race")).toHaveLength(0);
  });

  it("resolve unknown approval returns not_found", () => {
    requestApproval(workspaceDir, {
      matterId: "m-miss",
      requestedBy: "lawyer-1",
      reason: "x",
      riskLevel: "low",
    });
    expect(
      resolveApproval(workspaceDir, "m-miss", "missing-id", {
        status: "approved",
        resolvedBy: "lawyer-1",
      }),
    ).toEqual({ outcome: "not_found" });
  });

  it("listPendingApprovals filters by targetRole", () => {
    requestApproval(workspaceDir, {
      matterId: "m-role",
      requestedBy: "lawyer-1",
      reason: "合伙人签批",
      riskLevel: "high",
      targetRole: "partner",
    });
    requestApproval(workspaceDir, {
      matterId: "m-role",
      requestedBy: "lawyer-1",
      reason: "主办签批",
      riskLevel: "medium",
      targetRole: "associate",
    });
    expect(listPendingApprovals(workspaceDir, "m-role", { targetRole: "partner" })).toHaveLength(1);
    expect(listPendingApprovals(workspaceDir, "m-role")).toHaveLength(2);
  });

  it("resolve needs_changes transitions out of pending", () => {
    const created = requestApproval(workspaceDir, {
      matterId: "m-changes",
      requestedBy: "lawyer-1",
      reason: "需补充材料",
      riskLevel: "medium",
    });
    const resolved = resolveApproval(workspaceDir, "m-changes", created.approvalId, {
      status: "needs_changes",
      resolvedBy: "lawyer-2",
    });
    expect(resolved).toMatchObject({
      outcome: "written",
      approval: { status: "needs_changes", resolvedBy: "lawyer-2" },
    });
    expect(listPendingApprovals(workspaceDir, "m-changes")).toHaveLength(0);
  });

  it("listApprovals includes resolved records", () => {
    const created = requestApproval(workspaceDir, {
      matterId: "m-all",
      requestedBy: "lawyer-1",
      reason: "归档",
      riskLevel: "low",
    });
    resolveApproval(workspaceDir, "m-all", created.approvalId, {
      status: "approved",
      resolvedBy: "lawyer-1",
    });
    expect(listApprovals(workspaceDir, "m-all")).toHaveLength(1);
    expect(listApprovals(workspaceDir, "m-all")[0]?.status).toBe("approved");
  });
});
