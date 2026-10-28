import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { hydrateMatterParties } from "../desk/matter-parties.js";
import {
  createMatterRunOnDisk,
  loadMatterRun,
  saveMatterRun,
} from "../platform/matter-run-store.js";
import { startMatterRunStep, waitMatterRunStep } from "../platform/matter-run.js";
import {
  attachIntakeItem,
  detachIntakeItem,
  ignoreIntakeItem,
  restoreIntakeItem,
} from "./filing.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { resolveIntakeItem } from "./resolve.js";
import {
  getIntakeItem,
  intakeItemFullText,
  listIntakeItems,
  putIntakeBlob,
  readIntakeEvents,
  recordIntakeItem,
  updateIntakeItem,
} from "./store.js";
import type { NewIntakeItem } from "./types.js";

describe("intake store and resolution", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-test-"));
    dirs.push(dir);
    return dir;
  }

  function input(patch: Partial<NewIntakeItem> = {}): NewIntakeItem {
    return {
      channel: "email",
      externalKey: "email:account:1",
      receivedAt: "2026-10-26T00:00:00.000Z",
      from: { display: "Client", address: "client@example.com" },
      subject: "材料",
      text: "请看附件。",
      attachments: [],
      ...patch,
    };
  }

  it("records idempotently, keeps full long text in a blob, and appends events", () => {
    const dir = workspace();
    const text = "长文本".repeat(7000);
    const first = recordIntakeItem(dir, input({ text, thread: { messageId: "<m-1>" } }));
    const second = recordIntakeItem(
      dir,
      input({ text: "changed", thread: { messageId: "<M-1>" } }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(first.item.text.length).toBe(20_000);
    expect(intakeItemFullText(dir, first.item)).toBe(text);
    expect(listIntakeItems(dir, { statuses: ["pending"] })).toHaveLength(1);
    expect(readIntakeEvents(dir).map((event) => event.kind)).toEqual(["recorded"]);
  });

  it("keeps attachment blobs content-addressed", () => {
    const dir = workspace();
    const sha = putIntakeBlob(dir, Buffer.from("same"));
    expect(putIntakeBlob(dir, Buffer.from("same"))).toBe(sha);
    expect(
      fs.readFileSync(path.join(dir, "lawmind", "intake", "blobs", sha.slice(0, 2), sha), "utf8"),
    ).toBe("same");
  });

  it("requires one unique strong key for auto attachment", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    createMatterIfMissing(dir, { matterId: "matter-b", title: "乙案" });
    const a = recordIntakeItem(
      dir,
      input({
        externalKey: "email:a",
        subject: "【matter-a】补充材料",
        thread: { messageId: "m-a" },
      }),
    ).item;
    const index = buildIntakeMatterIndex(dir);
    const resolution = resolveIntakeItem(a, index);
    expect(resolution.decision).toBe("auto_attach");
    expect(resolution.candidates[0]?.matterId).toBe("matter-a");

    const ambiguous = recordIntakeItem(
      dir,
      input({
        externalKey: "email:ambiguous",
        subject: "甲案和乙案",
        from: undefined,
      }),
    ).item;
    expect(resolveIntakeItem(ambiguous, index).decision).toBe("unmatched");
  });

  it("keeps the same sender under different mailbox accounts as different identities", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-mail", title: "邮件案" });
    await updateMatterProfile(dir, {
      matterId: "matter-mail",
      parties: [
        {
          partyId: "p-client",
          name: "甲公司",
          role: "client",
          contacts: [
            {
              kind: "email",
              value: "client@example.com",
              account: "mailbox-a@firm.cn",
              verified: true,
              source: "lawyer",
            },
          ],
        },
      ],
    });
    const index = buildIntakeMatterIndex(dir);
    expect(index.matters[0]?.contacts[0]?.account).toBe("mailbox-a@firm.cn");

    const otherMailbox = recordIntakeItem(
      dir,
      input({ externalKey: "email:other-box", source: { accountId: "mailbox-b@firm.cn" } }),
    ).item;
    expect(resolveIntakeItem(otherMailbox, index).decision).toBe("unmatched");

    const sameMailbox = recordIntakeItem(
      dir,
      input({ externalKey: "email:same-box", source: { accountId: "mailbox-a@firm.cn" } }),
    ).item;
    expect(resolveIntakeItem(sameMailbox, index).decision).toBe("auto_attach");
  });

  it("does not auto-attach a DMARC-failed verified sender", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const matter = buildIntakeMatterIndex(dir);
    const item = recordIntakeItem(
      dir,
      input({
        externalKey: "email:dmarc-fail",
        dmarc: "fail",
        from: { display: "Client", address: "client@example.com" },
      }),
    ).item;
    expect(resolveIntakeItem(item, matter).decision).not.toBe("auto_attach");
  });

  it("attaches email material, then detaches it without deleting changed files", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const content = Buffer.from("proof");
    const sha = putIntakeBlob(dir, content);
    const item = recordIntakeItem(
      dir,
      input({
        channel: "upload",
        externalKey: "upload:filing",
        attachments: [
          { name: "证据.txt", sha256: sha, size: content.length, contentType: "text/plain" },
        ],
      }),
    ).item;
    const filed = attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" });
    expect(filed.ok).toBe(true);
    expect(getIntakeItem(dir, item.id)?.status).toBe("attached");
    const material = path.join(dir, "cases", "matter-a", "materials", "证据.txt");
    expect(fs.readFileSync(material, "utf8")).toBe("proof");
    fs.writeFileSync(material, "lawyer edit");
    expect(detachIntakeItem(dir, item.id).ok).toBe(true);
    expect(fs.existsSync(material)).toBe(true);
    expect(getIntakeItem(dir, item.id)?.status).toBe("pending");
  });

  it("materializes a recording transcript next to the audio and removes it on detach", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const audio = Buffer.from("audio-bytes");
    const sha = putIntakeBlob(dir, audio);
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:transcript",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "甲：你好。乙：收到。",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: audio.length }],
    }).item;
    updateIntakeItem(dir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [
          { startMs: 0, endMs: 1500, speaker: "S1", text: "甲：你好。" },
          { startMs: 1000, endMs: 3000, speaker: "S2", text: "乙：收到。" },
        ],
        speakerLabels: { S1: "张三" },
      },
    }));

    expect(attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" }).ok).toBe(true);
    const transcriptPath = path.join(dir, "cases", "matter-a", "materials", "通话录音 转写.txt");
    const text = fs.readFileSync(transcriptPath, "utf8");
    expect(text).toContain("- 来源：通话录音.mp3");
    expect(text).toContain("[00:00] 张三：甲：你好。");
    expect(text).toContain("[00:01] S2：乙：收到。");

    expect(detachIntakeItem(dir, item.id).ok).toBe(true);
    expect(fs.existsSync(transcriptPath)).toBe(false);
  });

  it("keeps a lawyer-edited recording transcript when detaching", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const audio = Buffer.from("audio-bytes");
    const sha = putIntakeBlob(dir, audio);
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:transcript-edited",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "甲：你好。",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: audio.length }],
    }).item;
    expect(attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" }).ok).toBe(true);
    const transcriptPath = path.join(dir, "cases", "matter-a", "materials", "通话录音 转写.txt");
    fs.writeFileSync(transcriptPath, "律师改过的转写");
    expect(detachIntakeItem(dir, item.id).ok).toBe(true);
    expect(fs.readFileSync(transcriptPath, "utf8")).toBe("律师改过的转写");
  });

  it("marks a lawyer-edited transcript in the materialized copy", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const audio = Buffer.from("audio-bytes");
    const sha = putIntakeBlob(dir, audio);
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:transcript-edited-marker",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "甲：你好。",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: audio.length }],
    }).item;
    updateIntakeItem(dir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            speaker: "S1",
            text: "甲：你好。",
            editedAt: "2026-10-27T02:00:00.000Z",
          },
        ],
        editedAt: "2026-10-27T02:00:00.000Z",
      },
    }));
    expect(attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" }).ok).toBe(true);
    const text = fs.readFileSync(
      path.join(dir, "cases", "matter-a", "materials", "通话录音 转写.txt"),
      "utf8",
    );
    expect(text).toContain("- 校对：律师已修改");
    expect(text).toContain("甲：你好。 〔律师改正〕");
  });

  it("uses the mapped party name in the filed transcript", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(dir, {
      matterId: "matter-a",
      parties: [{ partyId: "p-client", name: "甲公司", role: "client" }],
    });
    const audio = Buffer.from("audio-bytes");
    const sha = putIntakeBlob(dir, audio);
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:transcript-party-name",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "甲：你好。",
      attachments: [{ name: "通话录音.mp3", sha256: sha, size: audio.length }],
    }).item;
    updateIntakeItem(dir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [{ startMs: 0, endMs: 1000, speaker: "S1", text: "甲：你好。" }],
        speakerParties: { S1: { matterId: "matter-a", partyId: "p-client" } },
      },
    }));
    expect(attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" }).ok).toBe(true);
    const transcriptPath = path.join(dir, "cases", "matter-a", "materials", "通话录音 转写.txt");
    const text = fs.readFileSync(transcriptPath, "utf8");
    expect(text).toContain("[00:00] 甲公司：甲：你好。");
    expect(text).not.toContain("S1：");

    expect(detachIntakeItem(dir, item.id).ok).toBe(true);
    expect(fs.existsSync(transcriptPath)).toBe(false);
  });

  it("wakes a waiting MatterRun when new material is filed into its matter", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    const base = createMatterRunOnDisk(dir, {
      matterId: "matter-a",
      runId: "run_wait_material",
      steps: [{ kind: "draft_after_docs" }],
      at: "2026-10-26T00:00:00.000Z",
    });
    const waiting = waitMatterRunStep(
      startMatterRunStep(base, "s1", { at: "2026-10-26T01:00:00.000Z" }),
      "s1",
      {
        reason: "client_documents",
        eventKeys: ["matter:matter-a"],
        dueAt: "2026-11-01T00:00:00.000Z",
      },
      "2026-10-26T01:00:00.000Z",
    );
    saveMatterRun(dir, waiting);

    const item = recordIntakeItem(
      dir,
      input({ channel: "upload", externalKey: "upload:wake-run" }),
    ).item;
    expect(attachIntakeItem(dir, item.id, "matter-a", { by: "lawyer" }).ok).toBe(true);

    const after = loadMatterRun(dir, "matter-a", "run_wait_material");
    expect(after?.status).toBe("pending");
    expect(after?.steps[0]?.status).toBe("pending");
  });

  it("supports ignore and restore as lawyer-only queue state transitions", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, input({ externalKey: "email:ignore" })).item;
    expect(ignoreIntakeItem(dir, item.id).ok).toBe(true);
    expect(getIntakeItem(dir, item.id)?.status).toBe("ignored");
    expect(restoreIntakeItem(dir, item.id).ok).toBe(true);
    expect(getIntakeItem(dir, item.id)?.status).toBe("pending");
  });

  it("remembers the sender as the client's verified email when the lawyer asks", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(dir, {
      matterId: "matter-a",
      parties: [{ partyId: "p-client", name: "甲公司", role: "client" }],
    });
    const item = recordIntakeItem(dir, input({ externalKey: "email:remember" })).item;

    const filed = attachIntakeItem(dir, item.id, "matter-a", {
      by: "lawyer",
      rememberSender: true,
    });

    expect(filed.ok).toBe(true);
    expect(filed.ok && filed.rememberedSender).toBe(true);
    const stored = loadMatter(dir, "matter-a");
    const contacts = hydrateMatterParties(stored ?? {}).flatMap((p) => p.contacts ?? []);
    expect(contacts).toContainEqual(
      expect.objectContaining({
        kind: "email",
        value: "client@example.com",
        verified: true,
        source: "intake_confirmed",
      }),
    );
  });

  it("skips remembering when the matter has no client party", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-empty", title: "空案" });
    const item = recordIntakeItem(dir, input({ externalKey: "email:no-client" })).item;

    const filed = attachIntakeItem(dir, item.id, "matter-empty", {
      by: "lawyer",
      rememberSender: true,
    });

    expect(filed.ok).toBe(true);
    expect(filed.ok && filed.rememberedSender).toBeUndefined();
  });

  it("does not register the sender twice when another party already owns that email", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-dup", title: "重复案" });
    await updateMatterProfile(dir, {
      matterId: "matter-dup",
      parties: [
        { partyId: "p-client", name: "甲公司", role: "client" },
        {
          partyId: "p-counterparty",
          name: "乙公司",
          role: "counterparty",
          contacts: [{ kind: "email", value: "client@example.com", verified: true }],
        },
      ],
    });
    const item = recordIntakeItem(dir, input({ externalKey: "email:dup-sender" })).item;

    const filed = attachIntakeItem(dir, item.id, "matter-dup", {
      by: "lawyer",
      rememberSender: true,
    });

    expect(filed.ok).toBe(true);
    expect(filed.ok && filed.rememberedSender).toBe(false);
    expect(filed.ok && filed.rememberSkippedParties).toEqual(["乙公司"]);
    const stored = loadMatter(dir, "matter-dup");
    const client = hydrateMatterParties(stored ?? {}).find((party) => party.partyId === "p-client");
    expect(client?.contacts ?? []).toHaveLength(0);
    const owners = hydrateMatterParties(stored ?? {}).filter((party) =>
      (party.contacts ?? []).some((contact) => contact.value === "client@example.com"),
    );
    expect(owners.map((party) => party.name)).toEqual(["乙公司"]);
  });
});
