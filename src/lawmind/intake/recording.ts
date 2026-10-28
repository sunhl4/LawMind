/**
 * 录音通道（P2.1）：投递口里的音频文件 → `channel: "recording"` 的 IntakeItem，
 * 律师点「转写」后按配置的 ASR 端点出文字。
 *
 * 边界与既有约定一致：
 * - 录音文件先进统一收件库（`recordIntakeItem`），不另建第二套案件真相源；
 * - 音频原件按内容寻址放 `lawmind/intake/blobs/`，转写文字放 `bodySha256` 指向的新 blob；
 * - 转写是**律师主动触发**的外发（按钮），不是入库自动行为：客户语音不能在律师
 *   不知情时被送去云端；`egressMode: offline` 时非本机端点直接拒绝；
 * - 没配置 ASR（`LAWMIND_ASR_ENDPOINT`）时不出站，条目保持「只有音频、还没有文字」。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import { hydrateMatterParties } from "../desk/matter-parties.js";
import { createOutboundProxy } from "../platform/outbound-proxy.js";
import { isEgressOffline } from "../policy/workspace-policy.js";
import {
  getIntakeItem,
  putIntakeBlob,
  readIntakeBlob,
  updateIntakeItem,
  appendIntakeEvent,
} from "./store.js";
import type { IntakeItem, IntakeTranscriptSegment } from "./types.js";

export const INTAKE_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".amr",
  ".flac",
  ".opus",
  ".wma",
  ".webm",
  ".ogg",
]);

/** 单次转写的音频上限；超过时拒绝并停在原样，不做降级假装完成。 */
export const MAX_ASR_INPUT_BYTES = 50 * 1024 * 1024;

/** 文本字段为真源截断上限，与 store.ts 的 TEXT_CAP 一致（schema 同限）。 */
const ITEM_TEXT_CAP = 20_000;

const ASR_FETCH_TIMEOUT_MS = 120_000;

const asrProxy = createOutboundProxy({
  requestTag: "intake-asr",
  timeoutMs: ASR_FETCH_TIMEOUT_MS,
});

export type AsrConfig = {
  endpoint: string;
  apiKey?: string;
  model?: string;
};

export function isIntakeAudioFile(name: string): boolean {
  const leaf = name.trim().toLowerCase();
  const dot = leaf.lastIndexOf(".");
  return dot > 0 && INTAKE_AUDIO_EXTENSIONS.has(leaf.slice(dot));
}

/**
 * ASR 配置只从环境读取：`LAWMIND_ASR_ENDPOINT` 必填，
 * `LAWMIND_ASR_API_KEY` / `LAWMIND_ASR_MODEL`（OpenAI 兼容端点需要）可选。
 */
export function readAsrConfig(env: NodeJS.ProcessEnv = process.env): AsrConfig | undefined {
  const endpoint = env.LAWMIND_ASR_ENDPOINT?.trim();
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
    return undefined;
  }
  const apiKey = env.LAWMIND_ASR_API_KEY?.trim() || undefined;
  const model = env.LAWMIND_ASR_MODEL?.trim() || undefined;
  return { endpoint, apiKey, model };
}

function isLocalHttpEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function isTranscriptionEligible(item: IntakeItem): boolean {
  if (item.text.trim()) {
    return false;
  }
  const audio = item.attachments.find((row) => row.sha256 && isIntakeAudioFile(row.name));
  return Boolean(audio);
}

export type TranscribeReason =
  | "not_found"
  | "not_eligible"
  | "has_text"
  | "no_config"
  | "offline"
  | "no_blob"
  | "too_large"
  | "endpoint_failed"
  | "empty_transcript";

export type TranscribeResult =
  | { ok: true; item: IntakeItem; chars: number; via: string }
  | { ok: false; reason: TranscribeReason; error?: string };

function asrProxyBasedOnOverride(fetchImpl?: typeof fetch) {
  if (!fetchImpl) {
    return asrProxy;
  }
  return createOutboundProxy({
    requestTag: "intake-asr-test",
    timeoutMs: ASR_FETCH_TIMEOUT_MS,
    fetchImpl,
  });
}

function parseTranscript(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const rows = value as {
      text?: unknown;
      data?: unknown;
      result?: unknown;
      segments?: unknown;
    };
    if (typeof rows.text === "string") {
      return rows.text;
    }
    if (typeof rows.data === "string") {
      return rows.data;
    }
    if (rows.data && typeof rows.data === "object") {
      const nested = rows.data as { text?: unknown };
      if (typeof nested.text === "string") {
        return nested.text;
      }
    }
    if (typeof rows.result === "string") {
      return rows.result;
    }
  }
  return "";
}

export function asrTranscriptFromResponse(payload: unknown): string {
  return parseTranscript(payload).trim();
}

function responseSegments(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const rows = payload as { segments?: unknown; data?: unknown };
  if (Array.isArray(rows.segments)) {
    return rows.segments;
  }
  if (rows.data && typeof rows.data === "object") {
    const nested = rows.data as { segments?: unknown };
    if (Array.isArray(nested.segments)) {
      return nested.segments;
    }
  }
  return undefined;
}

function segmentMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function segmentMsFromSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000)
    : undefined;
}

/**
 * 从常见 ASR 响应里取分段：`start / end`（秒）或 `startMs / endMs`；
 * 端点只给整段文字时返回空数组，不编造时间轴。
 */
export function asrSegmentsFromResponse(payload: unknown): IntakeTranscriptSegment[] {
  const raw = responseSegments(payload);
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: IntakeTranscriptSegment[] = [];
  for (const row of raw.slice(0, 2000)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const segment = row as Record<string, unknown>;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (!text) {
      continue;
    }
    const startMs = segmentMs(segment.startMs) ?? segmentMsFromSeconds(segment.start);
    const endMs = segmentMs(segment.endMs) ?? segmentMsFromSeconds(segment.end);
    const speakerRaw = segment.speaker ?? segment.spk ?? segment.channel;
    const speaker =
      typeof speakerRaw === "string"
        ? speakerRaw.normalize("NFKC").trim().slice(0, 40) || undefined
        : typeof speakerRaw === "number" && Number.isFinite(speakerRaw)
          ? String(speakerRaw)
          : undefined;
    out.push({
      ...(startMs !== undefined ? { startMs } : {}),
      ...(endMs !== undefined ? { endMs } : {}),
      ...(speaker ? { speaker } : {}),
      text: text.slice(0, 4000),
    });
  }
  return out;
}

/**
 * 转写一条录音来件。成功后文字写回条目（全文留 blob）；失败时条目保持原样。
 */
export async function transcribeIntakeRecording(
  workspaceDir: string,
  itemId: string,
  opts?: { fetch?: typeof fetch; now?: Date; env?: NodeJS.ProcessEnv; force?: boolean },
): Promise<TranscribeResult> {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, reason: "not_found" };
  }
  if (item.text.trim() && opts?.force !== true) {
    return { ok: false, reason: "has_text" };
  }
  if (!item.attachments.some((row) => row.sha256 && isIntakeAudioFile(row.name))) {
    return { ok: false, reason: "not_eligible" };
  }
  const config = readAsrConfig(opts?.env);
  if (!config) {
    return { ok: false, reason: "no_config" };
  }
  if (isEgressOffline(workspaceDir) && !isLocalHttpEndpoint(config.endpoint)) {
    return { ok: false, reason: "offline" };
  }
  const attachment = item.attachments.find((row) => row.sha256 && isIntakeAudioFile(row.name));
  const audioSha = attachment?.sha256;
  if (!audioSha) {
    return { ok: false, reason: "not_eligible" };
  }
  const audio = readIntakeBlob(workspaceDir, audioSha);
  if (!audio) {
    return { ok: false, reason: "no_blob" };
  }
  if (audio.length > MAX_ASR_INPUT_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  const ext = (attachment?.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp3").toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), `audio${ext}`);
  if (config.model) {
    form.append("model", config.model);
  }
  const proxy = asrProxyBasedOnOverride(opts?.fetch);
  let payloadText = "";
  let segments: IntakeTranscriptSegment[] = [];
  try {
    const res = await proxy.fetch(config.endpoint, {
      method: "POST",
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "endpoint_failed",
        error: `HTTP ${res.status}: ${detail.trim().slice(0, 200)}`,
      };
    }
    const payload = await res.json().catch(() => undefined);
    payloadText = asrTranscriptFromResponse(payload);
    segments = asrSegmentsFromResponse(payload);
  } catch (err) {
    return {
      ok: false,
      reason: "endpoint_failed",
      error: err instanceof Error ? err.message : String(err).slice(0, 200),
    };
  }
  if (!payloadText) {
    return { ok: false, reason: "empty_transcript" };
  }
  const transcriptSha = putIntakeBlob(workspaceDir, Buffer.from(payloadText, "utf8"));
  const now = (opts?.now ?? new Date()).toISOString();
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (current.text.trim() && opts?.force !== true) {
      return undefined;
    }
    const next: IntakeItem = {
      ...current,
      text: payloadText.slice(0, ITEM_TEXT_CAP),
      bodySha256: transcriptSha,
    };
    if (segments.length > 0) {
      next.transcript = {
        segments,
        ...(current.transcript?.speakerLabels
          ? { speakerLabels: current.transcript.speakerLabels }
          : {}),
        ...(current.transcript?.speakerParties
          ? { speakerParties: current.transcript.speakerParties }
          : {}),
      };
    } else {
      delete next.transcript;
    }
    return next;
  });
  if (!updated) {
    return { ok: false, reason: "has_text" };
  }
  const via = new URL(config.endpoint).hostname;
  appendIntakeEvent(workspaceDir, {
    at: now,
    itemId,
    kind: "transcribed",
    by: "lawyer",
    detail: `via:${via} chars:${payloadText.length}${opts?.force ? " retranscribe" : ""}`,
  });
  return { ok: true, item: updated, chars: payloadText.length, via };
}

export type SpeakerLabelResult =
  | { ok: true; item: IntakeItem }
  | { ok: false; reason: "not_found" | "no_transcript" | "bad_speaker" };

/**
 * 律师改正某一段转写文字。成功后：
 * - 分段文字替换，`text` 变成分段按行拼接（搜索与预览用同一份）；
 * - 全文 blob 重新写入，`bodySha256` 指向新内容；
 * - `transcript.editedAt` 记时间，归档时据此标「律师已修改」。
 * 空文字拒绝，避免把一段清成空行。
 */
export type SegmentTextResult =
  | { ok: true; item: IntakeItem }
  | { ok: false; reason: "not_found" | "no_transcript" | "bad_segment" };

export function setIntakeTranscriptSegmentText(
  workspaceDir: string,
  itemId: string,
  index: number,
  text: string,
  opts?: { now?: Date },
): SegmentTextResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, reason: "not_found" };
  }
  if (!item.transcript || item.transcript.segments.length === 0) {
    return { ok: false, reason: "no_transcript" };
  }
  if (!Number.isInteger(index) || index < 0 || index >= item.transcript.segments.length) {
    return { ok: false, reason: "bad_segment" };
  }
  const clean = text.normalize("NFKC").trim().slice(0, 4000);
  if (!clean) {
    return { ok: false, reason: "bad_segment" };
  }
  const now = (opts?.now ?? new Date()).toISOString();
  const segments = item.transcript.segments.map((segment, i) =>
    i === index ? { ...segment, text: clean, editedAt: now } : segment,
  );
  const joined = segments
    .map((segment) => segment.text)
    .join("\n")
    .slice(0, ITEM_TEXT_CAP);
  const sha = putIntakeBlob(workspaceDir, Buffer.from(joined, "utf8"));
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (!current.transcript) {
      return undefined;
    }
    return {
      ...current,
      text: joined,
      bodySha256: sha,
      transcript: { ...current.transcript, segments, editedAt: now },
    };
  });
  return updated ? { ok: true, item: updated } : { ok: false, reason: "no_transcript" };
}

/**
 * 给某条录音的说话人键起一个律师可读的名字（例如映射到当事人）。
 * 空名字表示清掉映射。只允许已经出现在分段里的说话人键，避免写进脏键。
 */
export function setIntakeTranscriptSpeakerLabel(
  workspaceDir: string,
  itemId: string,
  speaker: string,
  label: string,
): SpeakerLabelResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, reason: "not_found" };
  }
  if (!item.transcript || item.transcript.segments.length === 0) {
    return { ok: false, reason: "no_transcript" };
  }
  const key = speaker.normalize("NFKC").trim().slice(0, 40);
  if (!key || !item.transcript.segments.some((segment) => segment.speaker === key)) {
    return { ok: false, reason: "bad_speaker" };
  }
  const clean = label.normalize("NFKC").trim().slice(0, 40);
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (!current.transcript) {
      return undefined;
    }
    const labels = { ...current.transcript.speakerLabels };
    if (clean) {
      labels[key] = clean;
    } else {
      delete labels[key];
    }
    const transcript = { ...current.transcript };
    if (Object.keys(labels).length > 0) {
      transcript.speakerLabels = labels;
    } else {
      delete transcript.speakerLabels;
    }
    return { ...current, transcript };
  });
  return updated ? { ok: true, item: updated } : { ok: false, reason: "no_transcript" };
}

export type SpeakerPartyResult =
  | { ok: true; item: IntakeItem }
  | {
      ok: false;
      reason: "not_found" | "no_transcript" | "bad_speaker" | "unknown_party";
    };

/**
 * 把说话人映射到某案的当事人（存 matterId + partyId）。传 null 清掉映射。
 * 当事人不存在时拒绝写入，避免把「长得像」的名字当成同一个人。
 */
export function setIntakeTranscriptSpeakerParty(
  workspaceDir: string,
  itemId: string,
  speaker: string,
  target: { matterId: string; partyId: string } | null,
): SpeakerPartyResult {
  const item = getIntakeItem(workspaceDir, itemId);
  if (!item) {
    return { ok: false, reason: "not_found" };
  }
  if (!item.transcript || item.transcript.segments.length === 0) {
    return { ok: false, reason: "no_transcript" };
  }
  const key = speaker.normalize("NFKC").trim().slice(0, 40);
  if (!key || !item.transcript.segments.some((segment) => segment.speaker === key)) {
    return { ok: false, reason: "bad_speaker" };
  }
  const matterId = target?.matterId.normalize("NFKC").trim().slice(0, 128);
  const partyId = target?.partyId.normalize("NFKC").trim().slice(0, 64);
  if (target && (!matterId || !partyId)) {
    return { ok: false, reason: "unknown_party" };
  }
  if (target && matterId && partyId) {
    const record = loadMatter(workspaceDir, matterId);
    const parties = record ? hydrateMatterParties(record) : [];
    if (!parties.some((party) => party.partyId === partyId)) {
      return { ok: false, reason: "unknown_party" };
    }
  }
  const updated = updateIntakeItem(workspaceDir, itemId, (current) => {
    if (!current.transcript) {
      return undefined;
    }
    const map = { ...current.transcript.speakerParties };
    if (matterId && partyId) {
      map[key] = { matterId, partyId };
    } else {
      delete map[key];
    }
    const transcript = { ...current.transcript };
    if (Object.keys(map).length > 0) {
      transcript.speakerParties = map;
    } else {
      delete transcript.speakerParties;
    }
    return { ...current, transcript };
  });
  return updated ? { ok: true, item: updated } : { ok: false, reason: "no_transcript" };
}
