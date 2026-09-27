/**
 * Resume record for one readonly sidecar (Cursor Task resume).
 * The parent history never stores this transcript.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { WorkerLoopMessage } from "./readonly-worker-loop.js";

const MAX_SAVED_MESSAGES = 16;
const MAX_SAVED_CONTENT = 4_000;

export type SidecarResumeRole = "review" | "draft" | "explore";

export type SidecarResumeRecord = {
  id: string;
  sessionId: string;
  section: string;
  role: SidecarResumeRole;
  messages: WorkerLoopMessage[];
  updatedAt: string;
};

export function newSidecarResumeId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `w${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function sidecarWorkerDir(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", `${safeSession(sessionId)}.workers`);
}

export function saveSidecarResume(
  workspaceDir: string,
  record: SidecarResumeRecord,
): SidecarResumeRecord | undefined {
  const id = safeResumeId(record.id);
  const sessionId = safeSession(record.sessionId);
  if (!id || !sessionId) {
    return undefined;
  }
  const stored: SidecarResumeRecord = {
    ...record,
    id,
    sessionId,
    messages: clipMessages(record.messages),
    updatedAt: new Date().toISOString(),
  };
  try {
    const dir = sidecarWorkerDir(workspaceDir, sessionId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filePath = path.join(dir, `${id}.json`);
    writeJsonAtomic(filePath, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function loadSidecarResume(
  workspaceDir: string,
  sessionId: string,
  resumeId: string,
): SidecarResumeRecord | undefined {
  const id = safeResumeId(resumeId);
  const session = safeSession(sessionId);
  if (!id || !session) {
    return undefined;
  }
  const filePath = path.join(sidecarWorkerDir(workspaceDir, session), `${id}.json`);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const rec = parsed as SidecarResumeRecord;
    if (rec.id !== id || rec.sessionId !== session || !Array.isArray(rec.messages)) {
      return undefined;
    }
    return rec;
  } catch {
    return undefined;
  }
}

/** Last assistant reply is stored whole. Earlier steps in the same record may be shortened. */
export const PARENT_ADMISSION_NOTE = "…（续跑记录留有最后一条完整答复，用 resume_id）";
export const PARENT_ADMISSION_EXHAUSTED =
  "本轮并行上下文配额已用完。用 resume_id 读续跑记录里的最后一条答复，更早的步骤可能只留了结尾。不要把没贴上的内容当成没有结论。";
export const PARENT_ADMISSION_EXHAUSTED_CONCLUSION = "最后答复在续跑记录";

/** Parent-visible draft cap. The resume file keeps the longer transcript. */
export function clipParentWorkerDraft(
  text: string,
  max = 1_600,
): { text: string; clipped: boolean } {
  const raw = text.trim();
  if (raw.length <= max) {
    return { text: raw, clipped: false };
  }
  return {
    text: fitParentAdmission(raw, max),
    clipped: true,
  };
}

/**
 * Fit a child result into the chars this turn still has.
 * The resume note stays inside the grant so a short remainder cannot cut it off.
 */
export function fitParentAdmission(
  text: string,
  granted: number,
  opts?: { note?: string; exhausted?: string },
): string {
  const raw = text.trim();
  const note = opts?.note ?? PARENT_ADMISSION_NOTE;
  const exhausted = opts?.exhausted ?? PARENT_ADMISSION_EXHAUSTED;
  if (granted <= 0) {
    return exhausted;
  }
  if (raw.length <= granted) {
    return raw;
  }
  if (granted <= note.length) {
    return note.slice(0, granted);
  }
  return `${raw.slice(0, granted - note.length)}${note}`;
}

function clipMessages(messages: WorkerLoopMessage[]): WorkerLoopMessage[] {
  const sliced = messages.slice(-MAX_SAVED_MESSAGES);
  let lastAssistant = -1;
  for (let i = sliced.length - 1; i >= 0; i -= 1) {
    if (sliced[i]?.role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  return sliced.map((message, index) => {
    if (index === lastAssistant) {
      return message;
    }
    return {
      ...message,
      content:
        message.content.length > MAX_SAVED_CONTENT
          ? `${message.content.slice(0, MAX_SAVED_CONTENT)}…`
          : message.content,
    };
  });
}

function safeResumeId(raw: string): string | undefined {
  const id = raw.trim();
  return /^w[a-f0-9]{16}$/.test(id) ? id : undefined;
}

function safeSession(raw: string): string | undefined {
  const id = raw.trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(id) ? id : undefined;
}
