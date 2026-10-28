/**
 * P1.1 收案记录：状态机、外发闸门、收案记录落在 agent 读不到的地方。
 *
 * 这组测试只证明「律师没接受委托之前，案件不能外发」这条硬边界；
 * 冲突扫描的召回质量属于 P1.2，不在这里用模型输出冒充。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import {
  listQueueItemsForMatter,
  openQueueItem,
} from "../application/services/queue-write-service.js";
import { isDeniedHostPath } from "../host-access/deny-list.js";
import {
  acknowledgeAdmissionDisclosures,
  admissionPath,
  admissionRoot,
  assignAdmissionOwner,
  beginConflictScan,
  checkAdmissionGate,
  createAdmission,
  decideAdmission,
  listAdmissions,
  loadAdmission,
  recordConflictScan,
} from "./admission.js";
import { acceptIntakeLead } from "./lead.js";
import { recordIntakeItem } from "./store.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-admission-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const HIT = {
  matterId: "other-matter",
  matterTitle: "他案",
  partyName: "李四",
  reason: "他案被告与本案候选当事人同名",
  source: "matter_record" as const,
};

function intakeMatter(dir: string, matterId = "matter-a") {
  return createMatterIfMissing(dir, { matterId, title: "甲案", status: "intake" });
}

function preparedAdmission(dir: string, matterId = "matter-a") {
  intakeMatter(dir, matterId);
  const created = createAdmission(dir, {
    matterId,
    matterTitle: "甲案",
    sourceItemIds: ["it-aaaaaaa1"],
    candidates: [{ name: "张三", role: "client", source: "intake", itemId: "it-aaaaaaa1" }],
    ownerLawyerId: "lawyer:desktop",
  });
  if (!created.ok) {
    throw new Error(created.error);
  }
  return created.admission;
}

describe("admission record", () => {
  it("starts prospective, keeps source items and candidates, and is idempotent", () => {
    const dir = workspace();
    const record = preparedAdmission(dir);
    expect(record.status).toBe("prospective");
    expect(record.conflict).toEqual({ status: "pending", hits: [] });
    expect(record.riskDisclosure.status).toBe("missing");
    expect(record.aiDisclosure.status).toBe("missing");
    expect(record.sourceItemIds).toEqual(["it-aaaaaaa1"]);
    expect(record.candidates[0]?.name).toBe("张三");
    expect(record.timeline.map((row) => row.kind)).toEqual(["created"]);

    const again = createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "someone-else" });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.admission.admissionId).toBe(record.admissionId);
      expect(again.admission.ownerLawyerId).toBe("lawyer:desktop");
    }
  });

  it("blocks accept until scan, owner, and both disclosures are complete", () => {
    const dir = workspace();
    preparedAdmission(dir);
    openQueueItem(dir, {
      matterId: "matter-a",
      kind: "need_conflict_check",
      title: "完成利益冲突检查",
      priority: "high",
    });

    expect(decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" })).toEqual({
      ok: false,
      error: "conflict_pending",
    });

    expect(recordConflictScan(dir, "matter-a", { hits: [], by: "lawyer" }).ok).toBe(true);
    expect(decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" })).toEqual({
      ok: false,
      error: "disclosures_missing",
    });

    const acked = acknowledgeAdmissionDisclosures(dir, "matter-a", {
      risk: true,
      ai: true,
      by: "lawyer",
    });
    expect(acked.ok).toBe(true);

    const accepted = decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.admission.status).toBe("accepted");
      expect(accepted.admission.decision?.kind).toBe("accept");
    }
    expect(loadMatter(dir, "matter-a")?.status).toBe("active");
    expect(
      listQueueItemsForMatter(dir, "matter-a", {
        kind: "need_conflict_check",
        status: "resolved",
      }),
    ).toHaveLength(1);
  });

  it("requires an explicit override when the conflict scan hits", () => {
    const dir = workspace();
    preparedAdmission(dir);
    expect(recordConflictScan(dir, "matter-a", { hits: [HIT], by: "lawyer" }).ok).toBe(true);
    acknowledgeAdmissionDisclosures(dir, "matter-a", { risk: true, ai: true, by: "lawyer" });

    expect(decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" })).toEqual({
      ok: false,
      error: "conflict_override_required",
    });

    const accepted = decideAdmission(dir, "matter-a", {
      decision: "accept",
      by: "lawyer",
      overrideReason: "已向双方披露并取得书面同意",
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.admission.conflict.overrideReason).toBe("已向双方披露并取得书面同意");
      expect(accepted.admission.conflict.hits).toHaveLength(1);
    }
  });

  it("declines without activating the matter and is idempotent on repeat accept", () => {
    const dir = workspace();
    preparedAdmission(dir);
    recordConflictScan(dir, "matter-a", { hits: [], by: "lawyer" });
    acknowledgeAdmissionDisclosures(dir, "matter-a", { risk: true, ai: true, by: "lawyer" });

    const first = decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" });
    expect(first.ok).toBe(true);
    const second = decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.admission.timeline.filter((row) => row.kind === "accepted")).toHaveLength(1);
    }
    expect(decideAdmission(dir, "matter-a", { decision: "decline", by: "lawyer" })).toEqual({
      ok: false,
      error: "already_decided",
    });

    // 另一个案子走婉拒：案件保持 intake，闸门给 declined。
    intakeMatter(dir, "matter-b");
    createAdmission(dir, { matterId: "matter-b", ownerLawyerId: "lawyer:desktop" });
    recordConflictScan(dir, "matter-b", { hits: [], by: "lawyer" });
    const declined = decideAdmission(dir, "matter-b", {
      decision: "decline",
      by: "lawyer",
      note: "超出业务范围",
    });
    expect(declined.ok).toBe(true);
    expect(loadMatter(dir, "matter-b")?.status).toBe("intake");
    expect(checkAdmissionGate(dir, "matter-b")).toMatchObject({
      allowed: false,
      reason: "declined",
    });
  });

  it("re-scanning clears stale hits and a completed scan moves to lawyer_review", () => {
    const dir = workspace();
    preparedAdmission(dir);
    recordConflictScan(dir, "matter-a", { hits: [HIT], by: "lawyer" });
    const rescan = beginConflictScan(dir, "matter-a", { by: "lawyer" });
    expect(rescan.ok).toBe(true);
    if (rescan.ok) {
      expect(rescan.admission.status).toBe("conflict_pending");
      expect(rescan.admission.conflict.hits).toHaveLength(0);
    }
    const cleared = recordConflictScan(dir, "matter-a", { hits: [], by: "lawyer" });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.admission.status).toBe("lawyer_review");
      expect(cleared.admission.conflict.status).toBe("clear");
    }
  });

  it("keeps the conflict scan out of the matter directory and agent-readable workspace", () => {
    const dir = workspace();
    preparedAdmission(dir);
    recordConflictScan(dir, "matter-a", { hits: [HIT], by: "lawyer" });
    const file = admissionPath(dir, "matter-a");
    expect(file.startsWith(admissionRoot(dir))).toBe(true);
    expect(fs.existsSync(path.join(dir, "matters", "matter-a", "admission.json"))).toBe(false);
    expect(isDeniedHostPath(file, { homeDir: os.homedir(), workspaceDir: dir })).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toContain("other-matter");
  });

  it("lists admissions by status and assigns an owner", () => {
    const dir = workspace();
    preparedAdmission(dir);
    intakeMatter(dir, "matter-c");
    createAdmission(dir, { matterId: "matter-c" });
    expect(listAdmissions(dir, { statuses: ["prospective"] })).toHaveLength(2);
    expect(listAdmissions(dir, { statuses: ["accepted"] })).toHaveLength(0);

    const assigned = assignAdmissionOwner(dir, "matter-c", {
      ownerLawyerId: "lawyer:zhang",
      by: "lawyer:desktop",
    });
    expect(assigned.ok).toBe(true);
    expect(loadAdmission(dir, "matter-c")?.ownerLawyerId).toBe("lawyer:zhang");
  });
});

describe("admission gate", () => {
  it("blocks intake matters without a record and grandfathers legacy/active matters", () => {
    const dir = workspace();
    intakeMatter(dir, "new-intake");
    expect(checkAdmissionGate(dir, "new-intake")).toMatchObject({
      allowed: false,
      reason: "admission_missing",
    });

    createMatterIfMissing(dir, { matterId: "legacy-active", title: "存量案件", status: "active" });
    expect(checkAdmissionGate(dir, "legacy-active")).toEqual({ allowed: true });

    // 只有 cases/<id>/CASE.md 的历史工作区没有 matter.json，不能追溯阻断。
    fs.mkdirSync(path.join(dir, "cases", "legacy-case"), { recursive: true });
    expect(checkAdmissionGate(dir, "legacy-case")).toEqual({ allowed: true });
  });

  it("allows outbound only after the lawyer accepts", () => {
    const dir = workspace();
    preparedAdmission(dir);
    expect(checkAdmissionGate(dir, "matter-a")).toMatchObject({
      allowed: false,
      reason: "prospective",
    });
    beginConflictScan(dir, "matter-a", { by: "lawyer" });
    expect(checkAdmissionGate(dir, "matter-a")).toMatchObject({
      allowed: false,
      reason: "conflict_pending",
    });
    recordConflictScan(dir, "matter-a", { hits: [], by: "lawyer" });
    expect(checkAdmissionGate(dir, "matter-a")).toMatchObject({
      allowed: false,
      reason: "lawyer_review",
    });
    acknowledgeAdmissionDisclosures(dir, "matter-a", { risk: true, ai: true, by: "lawyer" });
    decideAdmission(dir, "matter-a", { decision: "accept", by: "lawyer" });
    const gate = checkAdmissionGate(dir, "matter-a");
    expect(gate.allowed).toBe(true);
    expect(gate.admission?.status).toBe("accepted");
  });
});

describe("lead acceptance wiring", () => {
  it("creates the admission record with the sender and labeled parties as candidates", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "email",
      externalKey: "email:admission:1",
      receivedAt: "2026-10-26T04:00:00.000Z",
      from: { display: "张三", address: "zhang@client.test" },
      subject: "咨询",
      text: "被告：李四\n希望追回货款。",
      attachments: [],
    }).item;

    const result = acceptIntakeLead(dir, item.id, "货款纠纷", {
      ownerLawyerId: "lawyer:desktop",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.admission?.matterId).toBe("货款纠纷");
    expect(result.admission?.sourceItemIds).toEqual([item.id]);
    const names = result.admission?.candidates.map((row) => row.name) ?? [];
    expect(names).toContain("张三");
    expect(names).toContain("李四");
    expect(loadMatter(dir, "货款纠纷")?.status).toBe("intake");
    expect(checkAdmissionGate(dir, "货款纠纷")).toMatchObject({
      allowed: false,
      reason: "prospective",
    });
  });
});
