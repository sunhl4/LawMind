/**
 * P2.1 录音通道与转写：
 * - 投递口的音频文件按 `channel: "recording"` 入库（内容哈希去重不变）；
 * - 没配 ASR 时不出站，条目保持「只有音频」；
 * - 配置 `LAWMIND_ASR_ENDPOINT` 后，律师点「转写」才出站，文字写回条目；
 * - `egressMode: offline` 时非本机端点拒绝；测试给 fetchImpl 注入，不 stub 全局 fetch。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { ensureIntakeDropzone, scanIntakeDropzone } from "./dropzone.js";
import {
  isIntakeAudioFile,
  isTranscriptionEligible,
  asrSegmentsFromResponse,
  readAsrConfig,
  setIntakeTranscriptSegmentText,
  setIntakeTranscriptSpeakerLabel,
  setIntakeTranscriptSpeakerParty,
  transcribeIntakeRecording,
} from "./recording.js";
import { getIntakeItem, readIntakeEvents, recordIntakeItem, updateIntakeItem } from "./store.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-recording-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const AUDIO_ENV = {
  LAWMIND_ASR_ENDPOINT: "http://127.0.0.1:9/v1/audio/transcriptions",
  LAWMIND_ASR_MODEL: "whisper-1",
};

function fakeAudio(bytes = 2048): Buffer {
  return Buffer.alloc(bytes, 7);
}

/** 非全局 fetch stub：注入实现 + 本地 cassette 端点；引擎出口测试规则要求。 */
function cassette(build: (body: FormData) => Response | Promise<Response>) {
  return async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:\/\/127\.0\.0\.1:9\//.test(url)) {
      throw new Error(`outbound_url_not_allowed:${url}`);
    }
    const form = init?.body;
    if (!(form instanceof FormData)) {
      throw new Error("expected_multipart_form");
    }
    return build(form);
  };
}

describe("audio classification", () => {
  it("detects audio files by extension", () => {
    expect(isIntakeAudioFile("通话录音.mp3")).toBe(true);
    expect(isIntakeAudioFile("meeting.m4a")).toBe(true);
    expect(isIntakeAudioFile("voice.MP3")).toBe(true);
    expect(isIntakeAudioFile("合同.pdf")).toBe(false);
    expect(isIntakeAudioFile("noext")).toBe(false);
  });

  it("records dropped audio as the recording channel with the audio blob attached", () => {
    const dir = workspace();
    const root = ensureIntakeDropzone(dir);
    const old = new Date(Date.now() - 10_000);
    for (const [name, content] of [
      ["通话录音.mp3", fakeAudio()],
      ["证据.json", Buffer.from("{}")],
    ] as const) {
      const drop = path.join(root, name);
      fs.writeFileSync(drop, content);
      fs.utimesSync(drop, old, old);
    }

    const result = scanIntakeDropzone(dir, { now: new Date() });
    expect(result.recorded).toBe(2);

    // 逐条核对渠道：音频是 recording，其它仍是 dropzone。
    const itemsDir = path.join(dir, "lawmind", "intake", "items");
    const recorded = fs
      .readdirSync(itemsDir)
      .map((name) => JSON.parse(fs.readFileSync(path.join(itemsDir, name), "utf8")))
      .map((parsed) => ({
        channel: parsed.channel as string,
        name: parsed.attachments[0]?.name as string,
        text: parsed.text as string,
      }));
    expect(recorded).toContainEqual(
      expect.objectContaining({ channel: "recording", name: "通话录音.mp3", text: "" }),
    );
    expect(recorded).toContainEqual(
      expect.objectContaining({ channel: "dropzone", name: "证据.json" }),
    );
  });
});

describe("transcription adapter", () => {
  it("keeps audio-only items when no ASR endpoint is configured", async () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t1",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "",
      attachments: [{ name: "通话录音.mp3", sha256: "f".repeat(64), size: 10 }],
    }).item;
    writeAudioBlob(dir, item, 10);
    expect(isTranscriptionEligible(item)).toBe(true);
    expect(readAsrConfig({})).toBeUndefined();

    const result = await transcribeIntakeRecording(dir, item.id, { env: {} });
    expect(result).toEqual({ ok: false, reason: "no_config" });
    expect(getIntakeItem(dir, item.id)?.text).toBe("");
    const audio = readBlobOf(dir, item);
    expect(audio.byteLength).toBe(10);
  });

  it("sends the audio to the configured endpoint and writes the transcript back", async () => {
    const dir = workspace();
    const recorded = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t2",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "",
      attachments: [{ name: "通话录音.mp3", sha256: "a".repeat(64), size: 2048 }],
    }).item;
    writeAudioBlob(dir, recorded, 2048);

    let sawModel = false;
    const result = await transcribeIntakeRecording(dir, recorded.id, {
      env: AUDIO_ENV,
      fetch: cassette((form) => {
        sawModel = form.get("model") === "whisper-1";
        const file = form.get("file");
        expect(file instanceof Blob).toBe(true);
        return new Response(JSON.stringify({ text: "李四：欠款何时还？ 我方：下周。" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    expect(sawModel).toBe(true);
    expect(result).toMatchObject({ ok: true, chars: 16, via: "127.0.0.1" });
    const updated = getIntakeItem(dir, recorded.id);
    expect(updated?.text).toContain("李四：欠款何时还？");
    expect(updated?.attachments[0]?.sha256).toBe("a".repeat(64));
    // 音频原件保留（证据），转写文字去新的 blob：bodySha256 指向转写，不再是音频。
    expect(readBlobOf(dir, updated ?? recorded)?.byteLength).toBe(2048);
    expect(updated?.bodySha256).not.toBe("a".repeat(64));
    expect(updated?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(readIntakeEvents(dir, { limit: 2 }))).toContain("transcribed");
  });

  it("reads segments without inventing timestamps and drops empty rows", () => {
    expect(
      asrSegmentsFromResponse({
        segments: [
          { startMs: 1200, endMs: 2400, spk: 2, text: "好的" },
          { start: 3, end: 4, speaker: "S1", text: "   " },
        ],
      }),
    ).toEqual([{ startMs: 1200, endMs: 2400, speaker: "2", text: "好的" }]);
    expect(
      asrSegmentsFromResponse({
        data: { segments: [{ start: 1.5, end: 2, channel: "speaker_0", text: "收到" }] },
      }),
    ).toEqual([{ startMs: 1500, endMs: 2000, speaker: "speaker_0", text: "收到" }]);
    expect(asrSegmentsFromResponse({ text: "只有整段文字" })).toEqual([]);
  });

  it("keeps ASR segments and lets the lawyer label speakers", async () => {
    const dir = workspace();
    const recorded = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t4",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "会议录音.m4a",
      text: "",
      attachments: [{ name: "会议录音.m4a", sha256: "c".repeat(64), size: 512 }],
    }).item;
    writeAudioBlob(dir, recorded, 512);

    const result = await transcribeIntakeRecording(dir, recorded.id, {
      env: AUDIO_ENV,
      fetch: cassette(
        () =>
          new Response(
            JSON.stringify({
              text: "甲：合同什么时候签？ 乙：下周一。",
              segments: [
                { start: 0, end: 2.5, speaker: "S1", text: "甲：合同什么时候签？" },
                { start: 2.5, end: 5, speaker: "S2", text: "乙：下周一。" },
                { start: 5, end: 6, text: "   " },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    });
    expect(result.ok).toBe(true);
    const updated = getIntakeItem(dir, recorded.id);
    expect(updated?.transcript?.segments).toEqual([
      { startMs: 0, endMs: 2500, speaker: "S1", text: "甲：合同什么时候签？" },
      { startMs: 2500, endMs: 5000, speaker: "S2", text: "乙：下周一。" },
    ]);

    const labeled = setIntakeTranscriptSpeakerLabel(dir, recorded.id, "S1", "张三");
    expect(labeled.ok).toBe(true);
    if (labeled.ok) {
      expect(labeled.item.transcript?.speakerLabels).toEqual({ S1: "张三" });
    }
    const cleared = setIntakeTranscriptSpeakerLabel(dir, recorded.id, "S1", "  ");
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.item.transcript?.speakerLabels).toBeUndefined();
    }
    expect(setIntakeTranscriptSpeakerLabel(dir, recorded.id, "S9", "x")).toEqual({
      ok: false,
      reason: "bad_speaker",
    });
  });

  it("re-transcribes only when force is requested and keeps speaker labels", async () => {
    const dir = workspace();
    const recorded = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t6",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.mp3",
      text: "",
      attachments: [{ name: "通话录音.mp3", sha256: "d".repeat(64), size: 128 }],
    }).item;
    writeAudioBlob(dir, recorded, 128);
    const reply = (text: string) =>
      new Response(
        JSON.stringify({
          text,
          segments: [{ start: 0, end: 1, speaker: "S1", text }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const first = await transcribeIntakeRecording(dir, recorded.id, {
      env: AUDIO_ENV,
      fetch: cassette(() => reply("第一次")),
    });
    expect(first.ok).toBe(true);
    setIntakeTranscriptSpeakerLabel(dir, recorded.id, "S1", "张三");

    const again = await transcribeIntakeRecording(dir, recorded.id, {
      env: AUDIO_ENV,
      fetch: cassette(() => {
        throw new Error("should_not_call");
      }),
    });
    expect(again).toEqual({ ok: false, reason: "has_text" });

    const forced = await transcribeIntakeRecording(dir, recorded.id, {
      force: true,
      env: AUDIO_ENV,
      fetch: cassette(() => reply("第二次")),
    });
    expect(forced.ok).toBe(true);
    const updated = getIntakeItem(dir, recorded.id);
    expect(updated?.text).toBe("第二次");
    expect(updated?.transcript?.segments?.[0]?.text).toBe("第二次");
    expect(updated?.transcript?.speakerLabels).toEqual({ S1: "张三" });
  });

  it("refuses to label speakers when the item has no transcript", async () => {
    const dir = workspace();
    const textOnly = recordIntakeItem(dir, {
      channel: "email",
      externalKey: "email:t5",
      receivedAt: "2026-10-27T01:00:00.000Z",
      from: { display: "Client", address: "client@example.com" },
      subject: "材料",
      text: "没有录音。",
      attachments: [],
    }).item;
    expect(setIntakeTranscriptSpeakerLabel(dir, textOnly.id, "S1", "张三")).toEqual({
      ok: false,
      reason: "no_transcript",
    });
    expect(setIntakeTranscriptSpeakerLabel(dir, "it-missing-id", "S1", "张三")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("lets the lawyer correct one segment and refreshes the full text", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "upload",
      externalKey: "upload:segment-edit",
      receivedAt: "2026-10-27T01:00:00.000Z",
      text: "原一\n原二",
      attachments: [],
    }).item;
    updateIntakeItem(dir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [
          { startMs: 0, endMs: 1000, speaker: "S1", text: "原一" },
          { startMs: 1000, endMs: 2000, speaker: "S2", text: "原二" },
        ],
        speakerLabels: { S1: "张三" },
      },
    }));

    const result = setIntakeTranscriptSegmentText(dir, item.id, 1, "  改正后的第二段  ", {
      now: new Date("2026-10-27T02:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.transcript?.segments[1]?.text).toBe("改正后的第二段");
      expect(result.item.transcript?.segments[1]?.editedAt).toBe("2026-10-27T02:00:00.000Z");
      expect(result.item.transcript?.segments[0]?.editedAt).toBeUndefined();
      expect(result.item.transcript?.editedAt).toBe("2026-10-27T02:00:00.000Z");
      expect(result.item.text).toBe("原一\n改正后的第二段");
      expect(result.item.transcript?.speakerLabels).toEqual({ S1: "张三" });
      expect(result.item.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    }

    expect(setIntakeTranscriptSegmentText(dir, item.id, 5, "越界")).toEqual({
      ok: false,
      reason: "bad_segment",
    });
    expect(setIntakeTranscriptSegmentText(dir, item.id, 0, "   ")).toEqual({
      ok: false,
      reason: "bad_segment",
    });
    expect(setIntakeTranscriptSegmentText(dir, "it-missing-id", 0, "x")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("maps a speaker to a party of the chosen matter and rejects unknown parties", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(dir, {
      matterId: "matter-a",
      parties: [{ partyId: "p-client", name: "甲公司", role: "client" }],
    });
    const item = recordIntakeItem(dir, {
      channel: "upload",
      externalKey: "upload:speaker-party",
      receivedAt: "2026-10-27T01:00:00.000Z",
      text: "甲：你好。",
      attachments: [],
    }).item;
    updateIntakeItem(dir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [{ startMs: 0, endMs: 1000, speaker: "S1", text: "甲：你好。" }],
      },
    }));

    const mapped = setIntakeTranscriptSpeakerParty(dir, item.id, "S1", {
      matterId: "matter-a",
      partyId: "p-client",
    });
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(mapped.item.transcript?.speakerParties).toEqual({
        S1: { matterId: "matter-a", partyId: "p-client" },
      });
    }

    expect(
      setIntakeTranscriptSpeakerParty(dir, item.id, "S1", {
        matterId: "matter-a",
        partyId: "p-ghost",
      }),
    ).toEqual({ ok: false, reason: "unknown_party" });
    expect(
      setIntakeTranscriptSpeakerParty(dir, item.id, "S1", {
        matterId: "matter-missing",
        partyId: "p-client",
      }),
    ).toEqual({ ok: false, reason: "unknown_party" });

    // 名字和当事人映射互不覆盖。
    const labeled = setIntakeTranscriptSpeakerLabel(dir, item.id, "S1", "张三");
    expect(labeled.ok).toBe(true);
    if (labeled.ok) {
      expect(labeled.item.transcript?.speakerParties).toEqual({
        S1: { matterId: "matter-a", partyId: "p-client" },
      });
    }

    const cleared = setIntakeTranscriptSpeakerParty(dir, item.id, "S1", null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.item.transcript?.speakerParties).toBeUndefined();
      expect(cleared.item.transcript?.speakerLabels).toEqual({ S1: "张三" });
    }
  });

  it("refuses offline egress to a non-local endpoint and lets local endpoints pass", async () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t3",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.wav",
      text: "",
      attachments: [{ name: "通话录音.wav", sha256: "b".repeat(64), size: 4 }],
    }).item;
    writeAudioBlob(dir, item, 4);
    fs.writeFileSync(
      path.join(dir, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, egressMode: "offline" })}\n`,
      "utf8",
    );

    const cloud = await transcribeIntakeRecording(dir, item.id, {
      env: {
        LAWMIND_ASR_ENDPOINT: "https://asr.cloud.example/v1/audio/transcriptions",
      },
      fetch: cassette(() => new Response("{}", { status: 200 })),
    });
    expect(cloud).toEqual({ ok: false, reason: "offline" });

    const local = await transcribeIntakeRecording(dir, item.id, {
      env: {
        LAWMIND_ASR_ENDPOINT: "http://127.0.0.1:9/v1/audio/transcriptions",
      },
      fetch: cassette(
        () =>
          new Response(JSON.stringify({ text: "本机转写" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    expect(local).toMatchObject({ ok: true, chars: 4 });
  });

  it("does not pretend success when the endpoint fails or returns nothing", async () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t4",
      receivedAt: "2026-10-27T01:00:00.000Z",
      subject: "通话录音.aac",
      text: "",
      attachments: [{ name: "通话录音.aac", sha256: "c".repeat(64), size: 9 }],
    }).item;
    writeAudioBlob(dir, item, 9);

    const httpError = await transcribeIntakeRecording(dir, item.id, {
      env: AUDIO_ENV,
      fetch: cassette(() => new Response("boom", { status: 502 })),
    });
    expect(httpError).toMatchObject({
      ok: false,
      reason: "endpoint_failed",
      error: expect.stringContaining("502"),
    });
    expect(getIntakeItem(dir, item.id)?.text).toBe("");

    const empty = await transcribeIntakeRecording(dir, item.id, {
      env: AUDIO_ENV,
      fetch: cassette(
        () =>
          new Response(JSON.stringify({ text: "   " }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    });
    expect(empty).toEqual({ ok: false, reason: "empty_transcript" });
    expect(getIntakeItem(dir, item.id)?.text).toBe("");
  });

  it("refuses to re-transcribe an item that already has text", async () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, {
      channel: "recording",
      externalKey: "recording:t5",
      receivedAt: "2026-10-27T01:00:00.000Z",
      text: "已转写过",
      attachments: [{ name: "通话录音.mp3", sha256: "d".repeat(64), size: 5 }],
    }).item;
    const again = await transcribeIntakeRecording(dir, item.id, {
      env: AUDIO_ENV,
      fetch: cassette(() => new Response("{}", { status: 200 })),
    });
    expect(again).toEqual({ ok: false, reason: "has_text" });
  });
});

function audioBlobPath(dir: string, item: { attachments: Array<{ sha256?: string }> }): string {
  const sha = item.attachments[0]?.sha256 ?? "";
  return path.join(dir, "lawmind", "intake", "blobs", sha.slice(0, 2), sha);
}

/** 试验台：手工把音频放进 blob 目录（真实路径由 putIntakeBlob 建）。 */
function writeAudioBlob(
  dir: string,
  item: { attachments: Array<{ sha256?: string }> },
  bytes: number,
): void {
  const target = audioBlobPath(dir, item);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fakeAudio(bytes));
}

function readBlobOf(
  dir: string,
  item: { attachments: Array<{ sha256?: string }> },
): Uint8Array | undefined {
  try {
    return new Uint8Array(fs.readFileSync(audioBlobPath(dir, item)));
  } catch {
    return undefined;
  }
}
