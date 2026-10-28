import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FetchedMailMessage } from "../mail/imap-client.js";
import { upsertMailAccount, type MailAccount } from "../mail/mail-accounts.js";
import { syncIntakeMailbox, type IntakeMailFetch } from "./mail-intake.js";
import { listIntakeItems, readIntakeState } from "./store.js";
import type { IntakeMailCursor } from "./store.js";

const roots: string[] = [];

function workspace(): { workspaceDir: string; lawMindRoot: string } {
  const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-mail-"));
  const workspaceDir = path.join(lawMindRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  roots.push(lawMindRoot);
  return { workspaceDir, lawMindRoot };
}

function imapAccount(workspaceDir: string, lawMindRoot: string): MailAccount {
  return upsertMailAccount(workspaceDir, lawMindRoot, {
    provider: "imap",
    email: "intake@firm.test",
    imapHost: "imap.firm.test",
    intakeInbox: true,
  });
}

function graphAccount(workspaceDir: string, lawMindRoot: string): MailAccount {
  return upsertMailAccount(workspaceDir, lawMindRoot, {
    provider: "microsoft365",
    authKind: "graph_client",
    email: "intake@firm.test",
    tenantId: "tenant-1",
    clientId: "client-1",
    intakeInbox: true,
  });
}

function message(patch: Partial<FetchedMailMessage> = {}): FetchedMailMessage {
  return {
    id: "provider-message-1",
    from: "Client <client@example.com>",
    to: "intake@firm.test",
    subject: "补充材料",
    receivedAt: "2026-10-26T00:00:00.000Z",
    bodyText: "请查收。",
    attachments: [],
    messageId: "<message-1@example.com>",
    ...patch,
  };
}

function cursorSnapshot(cursors: IntakeMailCursor[]): IntakeMailFetch {
  return async (_account, _root, cursor) => {
    cursors.push(cursor);
    return { messages: [], cursor: { uidValidity: "uid-1", lastUid: 0 } };
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("intake mail watermark and retry behavior", () => {
  it("establishes an IMAP watermark on an empty first sync and resumes from UID 0", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = imapAccount(workspaceDir, lawMindRoot);
    const cursors: IntakeMailCursor[] = [];
    const now = new Date("2026-10-26T00:00:00.000Z");

    const first = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: cursorSnapshot(cursors),
      now,
    });
    const firstCursor = readIntakeState(workspaceDir).mail[account.id];

    expect(first).toMatchObject({ ok: true, accountId: account.id, fetched: 0, recorded: 0 });
    expect(firstCursor).toMatchObject({
      initializedAt: now.toISOString(),
      syncedAt: now.toISOString(),
      uidValidity: "uid-1",
      lastUid: 0,
    });
    expect(firstCursor?.bootstrapSince).toBeUndefined();
    expect(cursors[0]).toMatchObject({
      bootstrapSince: "2026-10-19T00:00:00.000Z",
    });

    const secondNow = new Date("2026-10-26T00:01:00.000Z");
    const second = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: cursorSnapshot(cursors),
      now: secondNow,
    });

    expect(second).toMatchObject({ ok: true, fetched: 0, recorded: 0 });
    expect(cursors[1]).toMatchObject({
      initializedAt: now.toISOString(),
      uidValidity: "uid-1",
      lastUid: 0,
    });
    expect(readIntakeState(workspaceDir).mail[account.id]?.syncedAt).toBe(secondNow.toISOString());
  });

  it("does not advance the watermark after a failed fetch, then retries from the old cursor", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = imapAccount(workspaceDir, lawMindRoot);
    const cursors: IntakeMailCursor[] = [];
    let attempts = 0;
    const fetched: IntakeMailFetch = async (_account, _root, cursor) => {
      cursors.push(cursor);
      attempts += 1;
      if (attempts === 1) {
        throw new Error("network_down");
      }
      return {
        messages: [message({ id: "after-retry", messageId: "<after-retry@example.com>" })],
        cursor: { uidValidity: "uid-1", lastUid: 9 },
      };
    };

    const failedAt = new Date("2026-10-26T01:00:00.000Z");
    const failed = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: fetched,
      now: failedAt,
    });
    const failedCursor = readIntakeState(workspaceDir).mail[account.id];

    expect(failed).toMatchObject({ ok: false, error: "sync_failed" });
    expect(failedCursor?.initializedAt).toBeUndefined();
    expect(failedCursor?.syncedAt).toBeUndefined();
    expect(failedCursor).toMatchObject({
      attemptedAt: failedAt.toISOString(),
      error: "network_down",
    });

    const recoveredAt = new Date("2026-10-26T01:02:00.000Z");
    const recovered = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: fetched,
      now: recoveredAt,
    });
    const recoveredCursor = readIntakeState(workspaceDir).mail[account.id];

    expect(recovered).toMatchObject({ ok: true, fetched: 1, recorded: 1 });
    expect(recoveredCursor).toMatchObject({
      initializedAt: recoveredAt.toISOString(),
      syncedAt: recoveredAt.toISOString(),
      uidValidity: "uid-1",
      lastUid: 9,
    });
    expect(recoveredCursor?.error).toBeUndefined();
    expect(listIntakeItems(workspaceDir, { statuses: ["pending"] })).toHaveLength(1);
    expect(cursors[1]).toMatchObject({
      bootstrapSince: "2026-10-19T01:02:00.000Z",
    });
  });

  it("accepts the first message at the seven-day boundary and deduplicates same-time retries", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = graphAccount(workspaceDir, lawMindRoot);
    const cursors: IntakeMailCursor[] = [];
    const boundary = "2026-10-19T02:00:00.000Z";
    const firstMessage = message({
      id: "boundary-1",
      messageId: "<boundary-1@example.com>",
      receivedAt: boundary,
    });
    const secondMessage = message({
      id: "boundary-2",
      messageId: "<boundary-2@example.com>",
      receivedAt: boundary,
      subject: "同一时间到达的另一封信",
    });
    let attempts = 0;
    const fetched: IntakeMailFetch = async (_account, _root, cursor) => {
      cursors.push(cursor);
      attempts += 1;
      return {
        messages: attempts === 1 ? [firstMessage] : [firstMessage, secondMessage],
        cursor: { receivedSince: boundary },
      };
    };
    const firstNow = new Date("2026-10-26T02:00:00.000Z");

    const first = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: fetched,
      now: firstNow,
    });
    const second = await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
      fetch: fetched,
      now: new Date("2026-10-26T02:01:00.000Z"),
    });

    expect(first).toMatchObject({ ok: true, fetched: 1, recorded: 1 });
    expect(second).toMatchObject({ ok: true, fetched: 2, recorded: 1 });
    expect(cursors[1]).toMatchObject({ receivedSince: boundary });
    expect(listIntakeItems(workspaceDir, { statuses: ["pending"] })).toHaveLength(2);
  });
});
