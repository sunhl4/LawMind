/**
 * 协作审计（所级报表）测试。
 *
 * 最要紧的一条不是报表好不好看，而是**兼容性**：
 * 给 `canonicalPayload` 加字段如果无条件加进哈希，既有的每一条审计链都会验签失败。
 * 所以这里专门验「老事件链仍然通过」。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireCheckoutLock,
  ensureMembershipWithOwner,
  releaseCheckoutLock,
  upsertLawyerIdentity,
} from "../matter-replica/index.js";
import type { AuditEvent } from "../types.js";
import {
  buildFirmCollaborationAuditReport,
  collabTaskId,
  collaborationKindLabel,
  emitCollaborationAudit,
  flushCollaborationAudit,
  formatFirmCollaborationAuditMarkdown,
} from "./collaboration-audit.js";
import { attachHashChain, verifyAuditHashChain } from "./hash-chain.js";
import { emit, readAllAuditLogs, readRecentAuditLogs } from "./index.js";

const tmpDirs: string[] = [];
const MID = "matter_audit2026";

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-collab-audit-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, "cases", MID, "materials"), { recursive: true });
  return dir;
}

/** 开 Firm 版：审计链与协作门控都会打开。 */
function firmWorkspace(policyExtra?: Record<string, unknown>): string {
  const ws = tmpWorkspace();
  fs.writeFileSync(
    path.join(ws, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, edition: "firm", ...policyExtra }),
    "utf8",
  );
  return ws;
}

function seedActor(ws: string): void {
  upsertLawyerIdentity(ws, {
    displayName: "张三",
    email: "zhang@firm.com",
    lawyerId: "lawyer_zhang",
  });
  ensureMembershipWithOwner(ws, {
    matterId: MID,
    matterTitle: "王某买卖合同纠纷",
    ownerLawyerId: "lawyer_zhang",
    ownerDisplayName: "张三",
  });
}

describe("兼容性：加 matterId 不能破坏既有审计链", () => {
  it("无 matterId 的事件哈希与加字段前一致（老链仍可验证）", () => {
    const dir = tmpDir();
    const file = path.join(dir, "2026-01-01.jsonl");
    const legacy: AuditEvent = {
      eventId: "e1",
      taskId: "task-1",
      kind: "task.created",
      actor: "lawyer",
      actorId: "lawyer:desktop",
      detail: "旧事件",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    // 手工按「加字段前」的 canonical 形状算一次期望哈希
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const key = Buffer.from([1, 2, 3, 4]);
    const expectedPayload = JSON.stringify({
      eventId: legacy.eventId,
      taskId: legacy.taskId,
      kind: legacy.kind,
      actor: legacy.actor,
      actorId: legacy.actorId ?? "",
      detail: legacy.detail ?? "",
      timestamp: legacy.timestamp,
    });
    const expected = createHmac("sha256", key).update(expectedPayload, "utf8").digest("hex");

    const stored = attachHashChain(file, legacy, { key });
    expect(stored.eventHash).toBe(expected);
  });

  it("带 matterId 的事件把 matterId 纳入哈希（受篡改保护）", () => {
    const dir = tmpDir();
    const fileA = path.join(dir, "a.jsonl");
    const fileB = path.join(dir, "b.jsonl");
    const key = Buffer.from([9, 9, 9, 9]);
    const base: AuditEvent = {
      eventId: "e2",
      taskId: collabTaskId(MID),
      kind: "collab.material_filed",
      actor: "lawyer",
      actorId: "lawyer_zhang",
      detail: "入卷",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const h1 = attachHashChain(fileA, { ...base, matterId: "matter_a" }, { key }).eventHash;
    const h2 = attachHashChain(fileB, { ...base, matterId: "matter_b" }, { key }).eventHash;
    // 只改 matterId，哈希必须变 —— 否则可以把协作事件「搬到」别的案件
    expect(h1).not.toBe(h2);
  });

  it("混合链（老事件 + 协作事件）整体仍能验证通过", () => {
    const dir = tmpDir();
    const file = path.join(dir, "2026-01-02.jsonl");
    const key = Buffer.from([7, 7, 7, 7]);
    const legacy: AuditEvent = {
      eventId: "l1",
      taskId: "task-1",
      kind: "task.created",
      actor: "lawyer",
      timestamp: "2026-01-02T00:00:00.000Z",
    };
    const collab: AuditEvent = {
      eventId: "c1",
      taskId: collabTaskId(MID),
      kind: "collab.invite_created",
      actor: "lawyer",
      actorId: "lawyer_zhang",
      actorName: "张三",
      matterId: MID,
      timestamp: "2026-01-02T00:00:01.000Z",
    };
    const first = attachHashChain(file, legacy, { key });
    fs.writeFileSync(file, `${JSON.stringify(first)}\n`, "utf8");
    const second = attachHashChain(file, collab, { key });
    fs.appendFileSync(file, `${JSON.stringify(second)}\n`, "utf8");

    const events = [first, second];
    expect(verifyAuditHashChain(events, { key }).ok).toBe(true);

    // 篡改协作事件的 matterId → 链验证必须失败
    const tampered = [...events];
    tampered[1] = { ...second, matterId: "matter_elsewhere" };
    expect(verifyAuditHashChain(tampered, { key }).ok).toBe(false);
  });
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-audit-tmp-"));
  tmpDirs.push(d);
  return d;
}

describe("协作事件写入审计链", () => {
  it("签出/释放会写入 collab.* 事件，且带 matterId 与操作者", async () => {
    const ws = firmWorkspace();
    seedActor(ws);
    acquireCheckoutLock(ws, {
      matterId: MID,
      matterTitle: "王某买卖合同纠纷",
      relPath: "materials/合同.docx",
    });
    releaseCheckoutLock(ws, MID, "materials/合同.docx");
    await flushCollaborationAudit();

    const events = await readAllAuditLogs(path.join(ws, "audit"));
    const kinds = events.filter((e) => e.kind.startsWith("collab.")).map((e) => e.kind);
    expect(kinds).toContain("collab.document_checked_out");
    expect(kinds).toContain("collab.document_released");

    const checkout = events.find((e) => e.kind === "collab.document_checked_out")!;
    expect(checkout.matterId).toBe(MID);
    expect(checkout.actorId).toBe("lawyer_zhang");
    expect(checkout.actorName).toBe("张三");
    expect(checkout.detail).toContain("合同.docx");
  });

  it("不 flush 时写入可能尚未落盘；flush 后必然可读", async () => {
    const ws = firmWorkspace();
    seedActor(ws);
    acquireCheckoutLock(ws, {
      matterId: MID,
      matterTitle: "案",
      relPath: "materials/a.docx",
    });
    await flushCollaborationAudit();
    const events = await readAllAuditLogs(path.join(ws, "audit"));
    expect(events.some((e) => e.kind === "collab.document_checked_out")).toBe(true);
  });

  it("审计链在**所有** edition 上都开启（含 Solo），协作事件同样受保护", async () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "solo", matterReplica: { enabled: true } }),
      "utf8",
    );
    seedActor(ws);
    acquireCheckoutLock(ws, { matterId: MID, matterTitle: "案", relPath: "materials/a.docx" });
    await flushCollaborationAudit();

    const events = await readAllAuditLogs(path.join(ws, "audit"));
    const collab = events.filter((e) => e.kind.startsWith("collab."));
    expect(collab.length).toBeGreaterThan(0);
    // auditIntegrityExport 在 edition 表里对 solo/firm/private 都是 true
    expect(collab.every((e) => typeof (e as { eventHash?: string }).eventHash === "string")).toBe(
      true,
    );
  });
});

describe("所级报表", () => {
  it("汇总按动作/案件/人，且报出链完整性", async () => {
    const ws = firmWorkspace();
    seedActor(ws);
    emitCollaborationAudit(ws, {
      matterId: MID,
      kind: "collab.invite_created",
      actorId: "lawyer_zhang",
      actorName: "张三",
      detail: "邀请 li@firm.com",
    });
    emitCollaborationAudit(ws, {
      matterId: MID,
      kind: "collab.document_checked_out",
      actorId: "lawyer_li",
      actorName: "李四",
      detail: "签出 materials/合同.docx",
    });
    emitCollaborationAudit(ws, {
      matterId: MID,
      kind: "collab.material_filed",
      actorId: "lawyer_li",
      actorName: "李四",
      detail: "入卷 2 份材料",
    });

    const report = await buildFirmCollaborationAuditReport(ws);
    expect(report.schemaVersion).toBe(1);
    expect(report.totals.events).toBe(3);
    expect(report.totals.matters).toBe(1);
    expect(report.totals.actors).toBe(2);
    expect(report.byKind.map((k) => k.kind)).toContain("collab.material_filed");
    expect(report.byActor.find((a) => a.actorId === "lawyer_li")?.events).toBe(2);
    expect(report.byActor.find((a) => a.actorId === "lawyer_zhang")?.displayName).toBe("张三");
    expect(report.byMatter[0]?.matterTitle).toBe("王某买卖合同纠纷");
    expect(report.events).toHaveLength(3);
  });

  it("事件自带的 actorName 优先于名册（已移出的人也显示得出名字）", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, {
      matterId: MID,
      kind: "collab.member_removed",
      actorId: "lawyer_former",
      actorName: "前同事",
      detail: "移出成员 lawyer_former",
    });
    const report = await buildFirmCollaborationAuditReport(ws);
    // 名册里没有这个人，但事件记着当时是谁做的
    expect(report.byActor[0]?.displayName).toBe("前同事");
  });

  it("按案件过滤", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, { matterId: MID, kind: "collab.material_filed", detail: "a" });
    emitCollaborationAudit(ws, {
      matterId: "matter_other",
      kind: "collab.material_filed",
      detail: "b",
    });

    const onlyMid = await buildFirmCollaborationAuditReport(ws, { matterId: MID });
    expect(onlyMid.totals.events).toBe(1);
    expect(onlyMid.byMatter[0]?.matterId).toBe(MID);
  });

  it("按时间范围过滤", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, { matterId: MID, kind: "collab.material_filed", detail: "old" });
    await flushCollaborationAudit();
    const future = new Date(Date.now() + 60_000).toISOString();
    const after = await buildFirmCollaborationAuditReport(ws, { since: future });
    expect(after.totals.events).toBe(0);
  });

  it("忽略非协作事件（任务类审计不进协作报表）", async () => {
    const ws = firmWorkspace();
    await emit(path.join(ws, "audit"), {
      taskId: "task-1",
      kind: "task.created",
      actor: "lawyer",
      detail: "与协作无关",
    });
    emitCollaborationAudit(ws, { matterId: MID, kind: "collab.material_filed", detail: "x" });
    const report = await buildFirmCollaborationAuditReport(ws);
    expect(report.totals.events).toBe(1);
    expect(report.range.scannedEvents).toBeGreaterThanOrEqual(2);
  });

  it("报表里的完整性结论真的是链校验结果", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, { matterId: MID, kind: "collab.material_filed", detail: "x" });
    const report = await buildFirmCollaborationAuditReport(ws);
    // Firm 版默认开链
    expect(report.integrity.chained).toBe(true);
    expect(report.integrity.ok).toBe(true);
    expect(report.integrity.note).toContain("审计链完整");
  });

  it("只有 legacy 无链事件时，报表如实说明「无防篡改保证」", async () => {
    const ws = firmWorkspace();
    // 直接写一条无 eventHash 的旧格式事件（模拟升级前留下的审计文件）
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const legacy = {
      eventId: "legacy-1",
      taskId: collabTaskId(MID),
      kind: "collab.material_filed",
      actor: "lawyer",
      actorId: "lawyer_zhang",
      matterId: MID,
      detail: "旧格式事件",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(auditDir, "2026-01-01.jsonl"),
      `${JSON.stringify(legacy)}\n`,
      "utf8",
    );

    const report = await buildFirmCollaborationAuditReport(ws);
    expect(report.totals.events).toBe(1);
    expect(report.integrity.chained).toBe(false);
    expect(report.integrity.note).toContain("未开启审计链");
  });

  it("Markdown 报表可打印，含动作中文名与完整性结论", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, {
      matterId: MID,
      kind: "collab.key_rotated",
      actorId: "lawyer_zhang",
      actorName: "张三",
      detail: "轮换案件密钥（发给 2 人，跳过 0 人）",
    });
    const md = formatFirmCollaborationAuditMarkdown(await buildFirmCollaborationAuditReport(ws));
    expect(md).toContain("# LawMind 协作审计报表（所级）");
    expect(md).toContain("轮换案件密钥");
    expect(md).toContain("完整性");
    expect(md).toContain("张三");
    expect(md).toContain(MID);
  });

  it("空报表不报错（新工作区）", async () => {
    const ws = firmWorkspace();
    const report = await buildFirmCollaborationAuditReport(ws);
    expect(report.totals.events).toBe(0);
    const md = formatFirmCollaborationAuditMarkdown(report);
    expect(md).toContain("该时间范围内没有协作事件");
  });

  it("动作中文名映射：已知可译，未知原样回退", () => {
    expect(collaborationKindLabel("collab.document_checked_out")).toBe("签出文件");
    expect(collaborationKindLabel("collab.unknown_future_kind")).toBe("collab.unknown_future_kind");
  });

  it("readRecentAuditLogs 仍可被报表复用（不破坏既有读取路径）", async () => {
    const ws = firmWorkspace();
    emitCollaborationAudit(ws, { matterId: MID, kind: "collab.material_filed", detail: "x" });
    await buildFirmCollaborationAuditReport(ws);
    const events = await readRecentAuditLogs(path.join(ws, "audit"), { maxEvents: 10 });
    expect(events.length).toBeGreaterThan(0);
  });
});
