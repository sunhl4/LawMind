/**
 * P2.2 企业微信会话存档（官方解密导出）→ 统一收件。
 *
 * 不测加密、不测 SDK：这里只锁「已解密消息文件」到 IntakeItem 的契约、
 * 目录移动、msgid 去重，以及坏文件不会每个 tick 重试。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureIntakeDropzone, intakeDropzoneDir, scanIntakeDropzone } from "./dropzone.js";
import { listIntakeItems, readIntakeEvents } from "./store.js";
import {
  ensureWecomArchiveDir,
  parseWecomArchive,
  scanWecomArchive,
  toIntakeItemInput,
  wecomArchiveDir,
} from "./wecom-archive.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-wecom-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const EXPORT = {
  users: { zhangsan: "张三", lisi: "李四" },
  messages: [
    {
      msgid: "m-1",
      action: "send",
      from: "zhangsan",
      tolist: ["lisi"],
      roomid: "room-1",
      roomname: "买卖合同群",
      msgtime: 1_700_000_000_000,
      msgtype: "text",
      text: { content: "李四，货款什么时候付？" },
    },
    {
      msgid: "m-2",
      action: "send",
      from: "lisi",
      tolist: ["zhangsan"],
      roomid: "room-1",
      roomname: "买卖合同群",
      msgtime: 1_700_000_060_000,
      msgtype: "text",
      text: { content: "下周安排。" },
    },
    {
      msgid: "m-3",
      action: "send",
      from: "lisi",
      tolist: ["zhangsan"],
      roomid: "room-1",
      roomname: "买卖合同群",
      msgtime: 1_700_000_120_000,
      msgtype: "file",
      file: { filename: "还款计划.pdf", filesize: 1234 },
    },
  ],
};

describe("wecom archive parsing", () => {
  it("parses the object export, resolves user names, and keeps group identity", () => {
    const archive = parseWecomArchive(JSON.stringify(EXPORT));
    expect(archive.users).toEqual({ zhangsan: "张三", lisi: "李四" });
    expect(archive.messages).toHaveLength(3);

    const input = toIntakeItemInput(archive.messages[0], {
      users: archive.users,
      sourceFile: "企业微信/export.json",
      now: new Date("2026-10-27T00:00:00.000Z"),
    });
    expect(input).toMatchObject({
      channel: "wecom",
      externalKey: "wecom:m-1",
      receivedAt: "2023-11-14T22:13:20.000Z",
      from: { display: "张三" },
      to: "李四",
      subject: "买卖合同群",
      text: "李四，货款什么时候付？",
      thread: { conversationId: "room:room-1" },
      source: { providerMessageId: "m-1", dropzoneRelPath: "企业微信/export.json" },
    });
  });

  it("supports JSONL and single-message objects", () => {
    const jsonl = `${JSON.stringify(EXPORT.messages[0])}\n${JSON.stringify(EXPORT.messages[1])}\n`;
    expect(parseWecomArchive(jsonl).messages).toHaveLength(2);
    expect(parseWecomArchive(JSON.stringify(EXPORT.messages[0])).messages).toHaveLength(1);
  });

  it("uses the room id for groups and a stable 1:1 id regardless of order", () => {
    const group = toIntakeItemInput(EXPORT.messages[0], {
      users: EXPORT.users,
      sourceFile: "x.json",
    });
    expect(group.thread?.conversationId).toBe("room:room-1");

    const dmA = toIntakeItemInput(
      { msgid: "dm-a", from: "lisi", tolist: ["zhangsan"], msgtype: "text", text: "你好" },
      { users: EXPORT.users, sourceFile: "x.json" },
    );
    const dmB = toIntakeItemInput(
      { msgid: "dm-b", from: "zhangsan", tolist: ["lisi"], msgtype: "text", text: "在" },
      { users: EXPORT.users, sourceFile: "x.json" },
    );
    expect(dmA.thread?.conversationId).toBe("dm:lisi,zhangsan");
    expect(dmB.thread?.conversationId).toBe("dm:lisi,zhangsan");
  });

  it("marks non-text media as metadata-only and keeps recalls as records", () => {
    const file = toIntakeItemInput(EXPORT.messages[2], {
      users: EXPORT.users,
      sourceFile: "x.json",
    });
    expect(file.text).toBe("[文件] 还款计划.pdf");
    expect(file.attachments).toEqual([
      { name: "还款计划.pdf", size: 1234, skippedReason: "type_not_persisted" },
    ]);

    const voice = toIntakeItemInput(
      { msgid: "v-1", from: "lisi", msgtype: "voice", voice: { duration: 12, filesize: 99 } },
      { sourceFile: "x.json" },
    );
    expect(voice.text).toBe("[语音 12″]");
    expect(voice.attachments?.[0]?.skippedReason).toBe("type_not_persisted");

    const recalled = toIntakeItemInput(
      { msgid: "r-1", action: "recall", from: "lisi", msgtype: "text", text: { content: "x" } },
      { sourceFile: "x.json" },
    );
    expect(recalled.text).toBe("[消息已撤回]");
  });
});

describe("wecom archive scanning", () => {
  it("imports each message once and moves the export out of the hot folder", async () => {
    const dir = workspace();
    ensureIntakeDropzone(dir);
    const archiveDir = ensureWecomArchiveDir(dir);
    fs.writeFileSync(path.join(archiveDir, "export.json"), JSON.stringify(EXPORT), "utf8");

    const now = new Date("2026-10-27T02:00:00.000Z");
    const first = await scanWecomArchive(dir, { now });
    expect(first).toMatchObject({ scanned: 1, recorded: 3, duplicates: 0, errors: [] });
    expect(listIntakeItems(dir, { statuses: ["pending"], limit: 10 })).toHaveLength(3);
    expect(
      fs.existsSync(
        path.join(intakeDropzoneDir(dir), "已入库", "2026-10-27", "企业微信", "export.json"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, "export.json"))).toBe(false);

    // 同一个导出再进来一次：msgid 去重，不重复入库。
    fs.writeFileSync(path.join(archiveDir, "export.json"), JSON.stringify(EXPORT), "utf8");
    const second = await scanWecomArchive(dir, { now });
    expect(second).toMatchObject({ scanned: 1, recorded: 0, duplicates: 3 });
    expect(listIntakeItems(dir, { statuses: ["pending"], limit: 10 })).toHaveLength(3);
  });

  it("leaves a bad export in a failed folder with an error instead of retrying forever", async () => {
    const dir = workspace();
    ensureIntakeDropzone(dir);
    const archiveDir = ensureWecomArchiveDir(dir);
    fs.writeFileSync(path.join(archiveDir, "broken.json"), "{not json", "utf8");

    const now = new Date("2026-10-27T02:00:00.000Z");
    const result = await scanWecomArchive(dir, { now });
    expect(result.recorded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(
      fs.existsSync(
        path.join(
          intakeDropzoneDir(dir),
          "已入库",
          "失败",
          "2026-10-27",
          "企业微信",
          "broken.json",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, "broken.json"))).toBe(false);
  });

  it("does not treat the wecom export folder as a generic dropzone item", async () => {
    const dir = workspace();
    ensureIntakeDropzone(dir);
    const archiveDir = ensureWecomArchiveDir(dir);
    const file = path.join(archiveDir, "export.json");
    fs.writeFileSync(file, JSON.stringify(EXPORT), "utf8");
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(file, old, old);

    expect((await scanIntakeDropzone(dir)).recorded).toBe(0);
    expect((await scanWecomArchive(dir)).recorded).toBe(3);
  });

  it("records a transcribed-event-free item: wecom imports carry no send/agent capability", async () => {
    const dir = workspace();
    ensureIntakeDropzone(dir);
    const archiveDir = ensureWecomArchiveDir(dir);
    fs.writeFileSync(path.join(archiveDir, "export.json"), JSON.stringify(EXPORT), "utf8");
    await scanWecomArchive(dir);
    const events = readIntakeEvents(dir, { limit: 50 });
    expect(events.every((row) => row.kind === "recorded" || row.kind === "resolved")).toBe(true);
  });
});

// 防回归：目录名必须和 dropzone 的跳过名单一致，否则 JSON 会被当成普通投递件。
it("keeps the wecom folder name aligned with the dropzone skip list", () => {
  expect(path.basename(wecomArchiveDir("/ws"))).toBe("企业微信");
});
