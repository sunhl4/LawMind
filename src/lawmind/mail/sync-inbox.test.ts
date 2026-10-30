import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertMailAccount } from "./mail-accounts.js";
import { syncMailAccountToMatter } from "./sync-inbox.js";

const roots: string[] = [];

function workspace(): { workspaceDir: string; lawMindRoot: string } {
  const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mail-sync-"));
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

describe("syncMailAccountToMatter", () => {
  it("refuses to pull an intake inbox into a single matter", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "imap",
      email: "intake@firm.test",
      imapHost: "imap.firm.test",
      intakeInbox: true,
    });

    const result = await syncMailAccountToMatter(workspaceDir, lawMindRoot, account.id, "matter-a");

    expect(result).toMatchObject({
      ok: false,
      error: "intake_inbox",
      accountId: account.id,
    });
    // 没有走网络、也没有把整箱信写进某一个案件的本地匣。
    expect(fs.existsSync(path.join(workspaceDir, "cases", "matter-a", "mail", "inbox"))).toBe(
      false,
    );
  });

  it("refuses to write mail into a matter that no longer exists", async () => {
    const { workspaceDir, lawMindRoot } = workspace();
    const account = upsertMailAccount(workspaceDir, lawMindRoot, {
      provider: "imap",
      email: "matter@firm.test",
      imapHost: "imap.firm.test",
      matterId: "ghost-matter",
    });

    const result = await syncMailAccountToMatter(
      workspaceDir,
      lawMindRoot,
      account.id,
      "ghost-matter",
    );

    expect(result).toMatchObject({
      ok: false,
      error: "matter_not_found",
      accountId: account.id,
    });
    expect(fs.existsSync(path.join(workspaceDir, "cases", "ghost-matter"))).toBe(false);
  });
});
