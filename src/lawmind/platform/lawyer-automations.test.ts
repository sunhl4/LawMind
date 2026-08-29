/**
 * @vitest-environment node
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processDueLawyerAutomations } from "./lawyer-automations-runner.js";
import {
  computeNextRunAt,
  createAutomation,
  extractNotifyEmail,
  inferAutomationFromInstruction,
  listOpenAutomationInbox,
  listMatterMailMessages,
  sanitizeNotifyEmail,
  writeMatterMailMessage,
  claimDueAutomation,
  listAutomations,
  deleteAutomation,
  buildMailDigestSummary,
} from "./lawyer-automations.js";

const dirs: string[] = [];

function tmpWs(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("lawyer-automations", () => {
  it("computes next daily run in the future", () => {
    const from = new Date("2026-07-18T12:00:00");
    const next = computeNextRunAt({ kind: "daily", hour: 9, minute: 0 }, from);
    expect(Date.parse(next)).toBeGreaterThan(from.getTime());
  });

  it("computes next interval run by everyMinutes", () => {
    const from = new Date("2026-07-18T12:00:00.000Z");
    const next = computeNextRunAt({ kind: "interval", everyMinutes: 30 }, from);
    expect(Date.parse(next) - from.getTime()).toBe(30 * 60_000);
  });

  it("infers mail contract preset from lawyer wording", () => {
    const inferred = inferAutomationFromInstruction("每天早上把邮箱里的合同附件拉下来做初审");
    expect(inferred.presetId).toBe("mail-contract-review");
  });

  it("rejects example.com notify emails", () => {
    expect(sanitizeNotifyEmail("client@example.com")).toBeUndefined();
    expect(extractNotifyEmail("发给 client@example.com")).toBeUndefined();
    expect(sanitizeNotifyEmail("counsel@acme-law.com")).toBe("counsel@acme-law.com");
    expect(extractNotifyEmail("请每周发给 counsel@acme-law.com")).toBe("counsel@acme-law.com");
  });

  it("enqueues mail-contract-redline for mail-contract-review with docx paths", async () => {
    const ws = tmpWs();
    const matterId = "m_demo_002";
    writeMatterMailMessage(ws, matterId, {
      id: "msg1",
      from: "对方律师 <a@firm.com>",
      to: "me@firm.com",
      subject: "合同修订稿",
      receivedAt: "2026-07-17T08:00:00.000Z",
      bodyText: "请将付款期限改为十五日",
      attachments: [
        {
          name: "nda.docx",
          relativePath: "mail/attachments/msg1/nda.docx",
        },
      ],
    });
    createAutomation(
      ws,
      {
        presetId: "mail-contract-review",
        matterId,
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const jobs: string[] = [];
    let enqueuedInstruction = "";
    const n = await processDueLawyerAutomations(
      ws,
      {
        enqueueTemplate: ({ templateId, instruction }) => {
          jobs.push(templateId);
          enqueuedInstruction = instruction ?? "";
          return "job-contract-1";
        },
      },
      new Date("2026-07-18T10:01:00Z"),
    );
    expect(n).toBe(1);
    expect(jobs).toEqual(["mail-contract-redline"]);
    expect(enqueuedInstruction).toContain("cases/m_demo_002/mail/attachments/msg1/nda.docx");
    expect(enqueuedInstruction).toContain("contract_edit_baseline_path");
    expect(enqueuedInstruction).toContain("render_tracked_draft");
    expect(enqueuedInstruction).toContain("search_workspace");
    expect(enqueuedInstruction).toContain("craft_check");
    expect(enqueuedInstruction).toMatch(/短路径/);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.jobId).toBe("job-contract-1");
    expect(inbox[0]?.summary).toContain("邮件合同审阅改稿");
    expect(listAutomations(ws)[0]?.enabled).toBe(false);
  });

  it("uses notifyEmail for weekly update pendingSend, never example.com", async () => {
    const ws = tmpWs();
    const matterId = "m_demo_003";
    createAutomation(
      ws,
      {
        presetId: "client-weekly-update",
        matterId,
        notifyEmail: "partner@client.com",
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    await processDueLawyerAutomations(
      ws,
      {
        enqueueTemplate: () => "job-weekly-1",
      },
      new Date("2026-07-18T10:01:00Z"),
    );
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.pendingSend?.to).toBe("partner@client.com");
    expect(inbox[0]?.pendingSend?.to).not.toContain("example.com");
  });

  it("runs mail digest into automation inbox", async () => {
    const ws = tmpWs();
    const matterId = "m_demo_001";
    writeMatterMailMessage(ws, matterId, {
      id: "msg1",
      from: "对方律师 <a@example.com>",
      to: "me@example.com",
      subject: "合同修订稿",
      receivedAt: "2026-07-17T08:00:00.000Z",
      bodyText: "请查收附件",
      attachments: [{ name: "nda.docx", relativePath: "nda.docx" }],
    });
    expect(listMatterMailMessages(ws, matterId)).toHaveLength(1);

    const auto = createAutomation(
      ws,
      {
        presetId: "mail-inbox-digest",
        matterId,
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    expect(auto.enabled).toBe(true);

    const n = await processDueLawyerAutomations(ws, {}, new Date("2026-07-18T10:01:00Z"));
    expect(n).toBe(1);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox.length).toBeGreaterThanOrEqual(1);
    expect(inbox[0]?.summary).toContain("合同修订稿");
  });

  it("skips disabled and not-yet-due automations", async () => {
    const ws = tmpWs();
    createAutomation(
      ws,
      {
        presetId: "mail-inbox-digest",
        matterId: "m_skip",
        schedule: { kind: "once", runAt: "2099-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const n = await processDueLawyerAutomations(ws, {}, new Date("2026-07-18T10:01:00Z"));
    expect(n).toBe(0);
  });

  it("records custom automation without template into inbox only", async () => {
    const ws = tmpWs();
    const matterId = "m_custom";
    createAutomation(
      ws,
      {
        presetId: "custom",
        matterId,
        instruction: "跟进对方是否回函",
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const n = await processDueLawyerAutomations(ws, {}, new Date("2026-07-18T10:01:00Z"));
    expect(n).toBe(1);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.title).toContain("待处理");
    expect(inbox[0]?.summary).toContain("跟进对方是否回函");
  });

  it("enqueues renewal-monitor template when due", async () => {
    const ws = tmpWs();
    const matterId = "m_renew";
    createAutomation(
      ws,
      {
        presetId: "renewal-monitor",
        matterId,
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const jobs: string[] = [];
    const n = await processDueLawyerAutomations(
      ws,
      {
        enqueueTemplate: ({ templateId }) => {
          jobs.push(templateId);
          return "job-renew-1";
        },
      },
      new Date("2026-07-18T10:01:00Z"),
    );
    expect(n).toBe(1);
    expect(jobs).toEqual(["renewal-monitor"]);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.summary).toContain("renewal-monitor");
  });

  it("marks mail-contract-review when attachments are missing", async () => {
    const ws = tmpWs();
    const matterId = "m_no_attach";
    writeMatterMailMessage(ws, matterId, {
      id: "msg-plain",
      from: "a@firm.com",
      to: "me@firm.com",
      subject: "无附件",
      receivedAt: "2026-07-17T08:00:00.000Z",
      bodyText: "仅正文",
      attachments: [],
    });
    createAutomation(
      ws,
      {
        presetId: "mail-contract-review",
        matterId,
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const n = await processDueLawyerAutomations(
      ws,
      { enqueueTemplate: () => "should-not-run" },
      new Date("2026-07-18T10:01:00Z"),
    );
    expect(n).toBe(1);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.summary).toMatch(/未发现带合同附件|无可审阅合同格式|无可用/);
    expect(inbox[0]?.jobId).toBeUndefined();
  });

  it("buildMailContractReviewSummary prefers newest docx workspace path", async () => {
    const { buildMailContractReviewSummary } = await import("./lawyer-automations.js");
    const built = buildMailContractReviewSummary(
      [
        {
          id: "newer",
          from: "对方 <opp@firm.com>",
          to: "me@firm.com",
          subject: "修订 v2",
          receivedAt: "2026-07-18T10:00:00.000Z",
          bodyText: "请改违约金",
          attachments: [{ name: "v2.docx", relativePath: "mail/attachments/newer/v2.docx" }],
        },
        {
          id: "older",
          from: "对方 <opp@firm.com>",
          to: "me@firm.com",
          subject: "修订 v1",
          receivedAt: "2026-07-17T10:00:00.000Z",
          bodyText: "初稿",
          attachments: [{ name: "v1.docx", relativePath: "mail/attachments/older/v1.docx" }],
        },
      ],
      "m_path_1",
    );
    expect(built.preferredBaselinePath).toBe("cases/m_path_1/mail/attachments/newer/v2.docx");
    expect(built.reviewMode).toBe("tracked");
    expect(built.replyToEmail).toBe("opp@firm.com");
    expect(built.workflowInstruction).toContain("prepare_outbound_mail");
  });

  it("buildMailContractShortPathInstruction embeds baseline path", async () => {
    const { buildMailContractShortPathInstruction } =
      await import("./mail-contract-short-path-instruction.js");
    const text = buildMailContractShortPathInstruction({
      matterId: "m1",
      preferredBaselinePath: "cases/m1/mail/attachments/x/a.docx",
    });
    expect(text).toContain("【邮件合同审阅");
    expect(text).toContain("contract_edit_baseline_path=`cases/m1/mail/attachments/x/a.docx`");
    expect(text).toContain("redlinePending");
    expect(text).toContain("批注");
    expect(text).toContain("apply_surgical_edits");
    expect(text).toContain("craft_check");
    expect(text).toContain("通读");
    expect(text).toContain("最小修改");
    expect(text).toContain("能改几个字就只改几个字");
    expect(text).toContain("硬门禁");
    expect(text).toContain("条数不限");
    expect(text).not.toContain("最多 24");
    expect(text).not.toContain("应改尽改");
    expect(text).not.toContain("2–3 处");
  });

  it("buildMailContractReviewSummary accepts pdf and schedules opinion mode", async () => {
    const { buildMailContractReviewSummary } = await import("./lawyer-automations.js");
    const built = buildMailContractReviewSummary(
      [
        {
          id: "pdf1",
          from: "对方 <opp@firm.com>",
          to: "me@firm.com",
          subject: "扫描件",
          receivedAt: "2026-07-18T10:00:00.000Z",
          bodyText: "请审查",
          attachments: [{ name: "合同.pdf", relativePath: "mail/attachments/pdf1/合同.pdf" }],
        },
      ],
      "m_pdf",
    );
    expect(built.attachmentRefs).toHaveLength(1);
    expect(built.reviewMode).toBe("opinion");
    expect(built.preferredSourcePath).toContain("合同.pdf");
    expect(built.workflowInstruction).toContain("意见书");
    expect(built.workflowInstruction).toContain("search_workspace");
    expect(built.workflowInstruction).toContain("Opinion Craft");
    expect(built.workflowInstruction).toContain("prepare_outbound_mail");
    expect(built.workflowInstruction).not.toContain("## 禁止");
  });

  it("materializeMailContractReviewBaselines keeps .doc as first-class baseline", async () => {
    const { buildMailContractReviewSummary, materializeMailContractReviewBaselines } =
      await import("./lawyer-automations.js");
    const ws = tmpWs();
    const matterId = "m_doc";
    const relMatter = "mail/attachments/msg-doc/合作协议.doc";
    const abs = path.join(ws, "cases", matterId, relMatter);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from("fake-doc-bytes"));
    const messages = [
      {
        id: "msg-doc",
        from: "对方 <opp@firm.com>",
        to: "me@firm.com",
        subject: "旧稿",
        receivedAt: "2026-07-18T10:00:00.000Z",
        bodyText: "请改",
        attachments: [{ name: "合作协议.doc", relativePath: relMatter }],
      },
    ];
    const drafted = buildMailContractReviewSummary(messages, matterId);
    expect(drafted.attachmentRefs[0]?.kind).toBe("tracked_word");
    const built = await materializeMailContractReviewBaselines(ws, messages, matterId, drafted);
    expect(built.reviewMode).toBe("tracked");
    expect(built.preferredBaselinePath).toBe(`cases/${matterId}/${relMatter}`);
    expect(built.preferredBaselinePath).toMatch(/\.doc$/i);
    expect(built.workflowInstruction).toContain("render_tracked_draft");
    // Must not force a sibling .docx conversion for the lawyer-facing baseline.
    expect(
      fs.existsSync(path.join(ws, built.preferredBaselinePath!.replace(/\.doc$/i, ".docx"))),
    ).toBe(false);
  });

  it("computeNextRunAt weekly schedule lands in future", () => {
    const from = new Date("2026-07-18T12:00:00");
    const next = computeNextRunAt({ kind: "weekly", weekday: 1, hour: 9, minute: 0 }, from);
    expect(Date.parse(next)).toBeGreaterThan(from.getTime());
  });

  it("listAutomations / deleteAutomation round-trip", () => {
    const ws = tmpWs();
    const auto = createAutomation(ws, {
      presetId: "custom",
      matterId: "m_list",
      instruction: "跟进",
      schedule: { kind: "once", runAt: "2099-01-01T00:00:00.000Z" },
    });
    expect(listAutomations(ws).some((a) => a.id === auto.id)).toBe(true);
    const autoDir = path.join(ws, "lawmind", "automations");
    expect(fs.readdirSync(autoDir).some((n) => n.includes(".tmp-") || n.endsWith(".lock"))).toBe(
      false,
    );
    expect(deleteAutomation(ws, auto.id)).toBe(true);
    expect(listAutomations(ws).some((a) => a.id === auto.id)).toBe(false);
  });

  it("writes an open inbox item when a due automation throws", async () => {
    const ws = tmpWs();
    const matterId = "m_fail_001";
    createAutomation(
      ws,
      {
        presetId: "client-weekly-update",
        matterId,
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const n = await processDueLawyerAutomations(
      ws,
      {
        enqueueTemplate: () => {
          throw new Error("missing_api_key: test");
        },
      },
      new Date("2026-07-18T10:01:00Z"),
    );
    expect(n).toBe(0);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox.some((item) => item.status === "open" && item.title === "自动办件失败")).toBe(
      true,
    );
    expect(inbox.some((item) => item.summary.includes("missing_api_key"))).toBe(true);
  });

  it("claimDueAutomation returns null on a second claim", () => {
    const ws = tmpWs();
    const auto = createAutomation(
      ws,
      {
        presetId: "custom",
        matterId: "matter-claim",
        instruction: "每周盯续签",
        schedule: { kind: "once", runAt: "2020-01-01T00:00:00.000Z" },
      },
      new Date("2026-07-18T10:00:00Z"),
    );
    const now = new Date("2026-07-18T10:01:00Z");
    expect(claimDueAutomation(ws, auto.id, now)?.id).toBe(auto.id);
    expect(claimDueAutomation(ws, auto.id, now)).toBeNull();
  });

  it("buildMailDigestSummary summarizes subjects", () => {
    const summary = buildMailDigestSummary([
      {
        id: "1",
        from: "a@firm.com",
        to: "me@firm.com",
        subject: "合同修订",
        receivedAt: "2026-07-18T08:00:00.000Z",
        bodyText: "正文",
        attachments: [],
      },
    ]);
    expect(summary).toContain("合同修订");
  });
});
