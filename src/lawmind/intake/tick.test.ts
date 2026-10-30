import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { upsertMailAccount } from "../mail/mail-accounts.js";
import type { IntakeMailFetch } from "./mail-intake.js";
import { getIntakeItem, recordIntakeItem } from "./store.js";
import { INTAKE_MAIL_POLL_MS, runIntakeTick } from "./tick.js";

const roots: string[] = [];

function workspace(): { workspaceDir: string; lawMindRoot: string } {
  const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-tick-"));
  const workspaceDir = path.join(lawMindRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  roots.push(lawMindRoot);
  return { workspaceDir, lawMindRoot };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("intake tick backoff and crash recovery", () => {
  it("does not retry a failed mailbox until the poll interval has passed", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "imap",
      email: "intake@firm.test",
      imapHost: "imap.firm.test",
      intakeInbox: true,
    });
    let calls = 0;
    const fetch: IntakeMailFetch = async () => {
      calls += 1;
      throw new Error("imap_down");
    };
    const started = new Date("2026-10-30T00:00:00.000Z");

    await runIntakeTick(workspaceDir, lawMindRoot, { now: started, fetch, accountId: account.id });
    await runIntakeTick(workspaceDir, lawMindRoot, {
      now: new Date(started.getTime() + 30_000),
      fetch,
      accountId: account.id,
    });
    expect(calls).toBe(1);

    await runIntakeTick(workspaceDir, lawMindRoot, {
      now: new Date(started.getTime() + INTAKE_MAIL_POLL_MS + 1_000),
      fetch,
      accountId: account.id,
    });
    expect(calls).toBe(2);
  });

  it("retriages a pending item that was recorded but never resolved", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    createMatterIfMissing(workspaceDir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(workspaceDir, {
      matterId: "matter-a",
      docket: { caseNo: "（2026）沪01民初1001号" },
    });
    const item = recordIntakeItem(workspaceDir, {
      channel: "email",
      externalKey: "email:tick:unfiled",
      receivedAt: "2026-10-30T00:00:00.000Z",
      subject: "补充",
      text: "案号（2026）沪01民初1001号。被告：王五。",
      attachments: [],
    }).item;
    expect(getIntakeItem(workspaceDir, item.id)?.resolution).toBeUndefined();

    await runIntakeTick(workspaceDir, lawMindRoot, {
      now: new Date("2026-10-30T00:01:00.000Z"),
    });

    const filed = getIntakeItem(workspaceDir, item.id);
    expect(filed?.status).toBe("attached");
    expect(filed?.filing?.matterId).toBe("matter-a");
    expect(loadMatter(workspaceDir, "matter-a")?.counterparty).toBe("王五");
  });

  it("keeps the dropzone folder hint when retriaging a crash leftover", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    createMatterIfMissing(workspaceDir, { matterId: "matter-a", title: "甲案" });
    const item = recordIntakeItem(workspaceDir, {
      channel: "dropzone",
      externalKey: "dropzone:tick:folder",
      receivedAt: "2026-10-30T00:00:00.000Z",
      subject: "起诉状.pdf",
      text: "",
      attachments: [{ name: "起诉状.pdf", size: 12 }],
      source: { dropzoneRelPath: "matter-a/起诉状.pdf" },
    }).item;

    await runIntakeTick(workspaceDir, lawMindRoot, {
      now: new Date("2026-10-30T00:01:00.000Z"),
    });

    const filed = getIntakeItem(workspaceDir, item.id);
    expect(filed?.status).toBe("attached");
    expect(filed?.filing?.matterId).toBe("matter-a");
  });
});
