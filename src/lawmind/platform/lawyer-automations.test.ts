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

  it("enqueues contract-review for mail-contract-review with attachments", async () => {
    const ws = tmpWs();
    const matterId = "m_demo_002";
    writeMatterMailMessage(ws, matterId, {
      id: "msg1",
      from: "对方律师 <a@firm.com>",
      to: "me@firm.com",
      subject: "合同修订稿",
      receivedAt: "2026-07-17T08:00:00.000Z",
      bodyText: "请查收附件",
      attachments: [{ name: "nda.docx", relativePath: "nda.docx" }],
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
    const n = await processDueLawyerAutomations(
      ws,
      {
        enqueueTemplate: ({ templateId }) => {
          jobs.push(templateId);
          return "job-contract-1";
        },
      },
      new Date("2026-07-18T10:01:00Z"),
    );
    expect(n).toBe(1);
    expect(jobs).toEqual(["contract-review"]);
    const inbox = listOpenAutomationInbox(ws, matterId);
    expect(inbox[0]?.jobId).toBe("job-contract-1");
    expect(inbox[0]?.summary).toContain("合同审查工作流");
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
});
