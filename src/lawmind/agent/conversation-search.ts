/**
 * Cross-conversation search for LawMind sessions (Cursor/Codex-style).
 *
 * Live scan of `sessions/*.json` plus transcript jsonl so compacted history
 * still matches. Returns titles + short snippets, never a full dump.
 */

import fs from "node:fs";
import path from "node:path";
import { transcriptPath } from "../adapters/session-transcript/index.js";
import {
  parseConversationSearchQuery,
  resolveRelativeTimeWindow,
  type ParsedConversationQuery,
} from "./conversation-search-query.js";
import { displayChatSessionTitle, listSessions } from "./session.js";
import { isLawyerVisibleChatMessage, type AgentMessage, type AgentSession } from "./types.js";

export {
  parseConversationSearchQuery,
  resolveRelativeTimeWindow,
  type ConversationTimeWindow,
  type ParsedConversationQuery,
  type RelativeKind,
} from "./conversation-search-query.js";

const MAX_SESSIONS_SCANNED = 800;
const CITE_LABEL_MAX = 80;
const MAX_TRANSCRIPT_BYTES = 512_000;
const MAX_MESSAGE_CHARS = 2_400;
const MAX_SEARCH_TEXT_CHARS = 80_000;
const DEFAULT_HIT_LIMIT = 8;
const MAX_HIT_LIMIT = 20;
const SNIPPET_CHARS = 180;
const MAX_SNIPPETS_PER_HIT = 2;
const DEFAULT_READ_MESSAGES = 24;
const MAX_READ_MESSAGES = 40;
const MAX_READ_CHARS = 10_000;
const MAX_READ_MESSAGE_CHARS = 1_200;

export const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function isSafeSessionId(raw: string): boolean {
  const id = raw.trim();
  return SESSION_ID_RE.test(id) && !id.includes("..");
}

export type ConversationVisibleMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

export type ConversationSearchHit = {
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
  createdAt: string;
  updatedAt: string;
  score: number;
  snippets: Array<{ role: "user" | "assistant"; text: string }>;
  /** Lawyer-clickable markdown; copy into the assistant reply. */
  citeAs: string;
};

export type ConversationSessionRef = {
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
};

export function formatConversationCiteAs(
  sessionId: string,
  title: string,
  assistantId?: string,
): string {
  const cleaned =
    title
      .replace(/[[\]\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || sessionId;
  const label =
    cleaned.length > CITE_LABEL_MAX ? `${cleaned.slice(0, CITE_LABEL_MAX - 1)}…` : cleaned;
  const aid = assistantId?.trim();
  const href =
    aid && isSafeSessionId(aid) ? `lm-session:${sessionId}?a=${aid}` : `lm-session:${sessionId}`;
  return `[${label}](${href})`;
}

function optionalId(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t ? t : undefined;
}

export function conversationSessionRefsFromToolData(
  toolName: string,
  data: unknown,
): ConversationSessionRef[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const rec = data as Record<string, unknown>;
  if (toolName === "search_conversations" && Array.isArray(rec.hits)) {
    const out: ConversationSessionRef[] = [];
    const seen = new Set<string>();
    for (const row of rec.hits.slice(0, 8)) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const hit = row as Record<string, unknown>;
      const sessionId = typeof hit.sessionId === "string" ? hit.sessionId.trim() : "";
      if (!isSafeSessionId(sessionId) || seen.has(sessionId)) {
        continue;
      }
      seen.add(sessionId);
      const title =
        typeof hit.title === "string" && hit.title.trim() ? hit.title.trim() : sessionId;
      out.push({
        sessionId,
        title,
        matterId: typeof hit.matterId === "string" ? optionalId(hit.matterId) : undefined,
        assistantId: typeof hit.assistantId === "string" ? optionalId(hit.assistantId) : undefined,
      });
    }
    return out;
  }
  if (toolName === "read_conversation") {
    const sessionId = typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
    if (!isSafeSessionId(sessionId)) {
      return [];
    }
    const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : sessionId;
    return [
      {
        sessionId,
        title,
        matterId: typeof rec.matterId === "string" ? optionalId(rec.matterId) : undefined,
        assistantId: typeof rec.assistantId === "string" ? optionalId(rec.assistantId) : undefined,
      },
    ];
  }
  return [];
}

export type ConversationSearchOpts = {
  query: string;
  excludeSessionId?: string;
  since?: string;
  until?: string;
  days?: number;
  limit?: number;
  assistantId?: string;
  nowMs?: number;
};

export type ConversationTimeMode = "none" | "boost" | "filter";

export type ConversationSearchResult = {
  query: string;
  keywords: string[];
  phrases: string[];
  since?: string;
  until?: string;
  /** boost = Cursor-like recency preference; filter = explicit days/since or bare「上周」. */
  timeMode: ConversationTimeMode;
  hits: ConversationSearchHit[];
  scanned: number;
};

type IndexedConversation = {
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
  createdAt: string;
  updatedAt: string;
  createdMs: number;
  updatedMs: number;
  messages: ConversationVisibleMessage[];
  haystack: string;
};

const indexCache = new Map<
  string,
  { jsonMtime: number; jsonSize: number; trMtime: number; trSize: number; doc: IndexedConversation }
>();

function parseIsoMs(raw: string | undefined): number | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const t = Date.parse(raw.trim());
  return Number.isFinite(t) ? t : undefined;
}

export function resolveConversationTimeWindow(opts: {
  parsed: ParsedConversationQuery;
  since?: string;
  until?: string;
  days?: number;
  nowMs: number;
}): { sinceMs?: number; untilMs?: number; since?: string; until?: string } {
  const untilExplicit = parseIsoMs(opts.until);
  const sinceExplicit = parseIsoMs(opts.since);
  if (sinceExplicit != null || untilExplicit != null) {
    return {
      sinceMs: sinceExplicit,
      untilMs: untilExplicit,
      since: sinceExplicit != null ? new Date(sinceExplicit).toISOString() : undefined,
      until: untilExplicit != null ? new Date(untilExplicit).toISOString() : undefined,
    };
  }
  const days =
    typeof opts.days === "number" && Number.isFinite(opts.days) && opts.days > 0
      ? Math.min(365, Math.floor(opts.days))
      : undefined;
  if (days != null) {
    const sinceMs = opts.nowMs - days * 24 * 60 * 60 * 1000;
    return { sinceMs, untilMs: opts.nowMs, since: new Date(sinceMs).toISOString() };
  }
  if (opts.parsed.relative) {
    const win = resolveRelativeTimeWindow(opts.parsed.relative.kind, opts.nowMs);
    return {
      sinceMs: win.sinceMs,
      untilMs: win.untilMs,
      since: new Date(win.sinceMs).toISOString(),
      until: new Date(win.untilMs).toISOString(),
    };
  }
  return {};
}

function clipMessage(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  if (t.length <= MAX_MESSAGE_CHARS) {
    return t;
  }
  return t.slice(0, MAX_MESSAGE_CHARS);
}

function visibleFromMessages(messages: AgentMessage[]): ConversationVisibleMessage[] {
  const out: ConversationVisibleMessage[] = [];
  for (const msg of messages) {
    if (!isLawyerVisibleChatMessage(msg)) {
      continue;
    }
    const content = clipMessage(msg.content ?? "");
    if (!content) {
      continue;
    }
    out.push({ role: msg.role, content, timestamp: msg.timestamp });
  }
  return out;
}

function readTranscriptTailUtf8(fp: string, maxBytes: number): string {
  const st = fs.statSync(fp);
  if (st.size <= maxBytes) {
    return fs.readFileSync(fp, "utf8");
  }
  const fd = fs.openSync(fp, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, Math.max(0, st.size - maxBytes));
    const text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(nl + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

function loadTranscriptVisible(
  workspaceDir: string,
  sessionId: string,
): ConversationVisibleMessage[] {
  const fp = transcriptPath(workspaceDir, sessionId);
  let raw: string;
  try {
    raw = readTranscriptTailUtf8(fp, MAX_TRANSCRIPT_BYTES);
  } catch {
    return [];
  }
  const out: ConversationVisibleMessage[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    try {
      const parsed = JSON.parse(t) as { kind?: string; content?: string; timestamp?: string };
      if (parsed.kind !== "user" && parsed.kind !== "assistant") {
        continue;
      }
      const content = clipMessage(typeof parsed.content === "string" ? parsed.content : "");
      if (!content) {
        continue;
      }
      out.push({
        role: parsed.kind,
        content,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
      });
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

function preferRicherMessages(
  history: ConversationVisibleMessage[],
  transcript: ConversationVisibleMessage[],
): ConversationVisibleMessage[] {
  if (transcript.length > history.length) {
    return transcript;
  }
  if (transcript.length === 0) {
    return history;
  }
  const histChars = history.reduce((n, m) => n + m.content.length, 0);
  const trChars = transcript.reduce((n, m) => n + m.content.length, 0);
  return trChars > histChars ? transcript : history;
}

function haystackFor(title: string, messages: ConversationVisibleMessage[]): string {
  let text = `${title}\n`;
  for (const msg of messages) {
    text += `${msg.content}\n`;
    if (text.length >= MAX_SEARCH_TEXT_CHARS) {
      return text.slice(0, MAX_SEARCH_TEXT_CHARS).toLowerCase();
    }
  }
  return text.toLowerCase();
}

function cacheKey(workspaceDir: string, sessionId: string): string {
  return `${workspaceDir}\0${sessionId}`;
}

function indexSession(workspaceDir: string, session: AgentSession): IndexedConversation {
  const sid = session.sessionId;
  const jsonPath = path.join(workspaceDir, "sessions", `${sid}.json`);
  const trPath = transcriptPath(workspaceDir, sid);
  let jsonMtime = 0;
  let jsonSize = 0;
  let trMtime = 0;
  let trSize = 0;
  try {
    const st = fs.statSync(jsonPath);
    jsonMtime = st.mtimeMs;
    jsonSize = st.size;
  } catch {
    /* missing */
  }
  try {
    const st = fs.statSync(trPath);
    trMtime = st.mtimeMs;
    trSize = st.size;
  } catch {
    /* no transcript */
  }
  const key = cacheKey(workspaceDir, sid);
  const cached = indexCache.get(key);
  if (
    cached &&
    cached.jsonMtime === jsonMtime &&
    cached.jsonSize === jsonSize &&
    cached.trMtime === trMtime &&
    cached.trSize === trSize
  ) {
    return cached.doc;
  }
  const title = displayChatSessionTitle(session);
  const messages = preferRicherMessages(
    visibleFromMessages(session.conversationHistory ?? []),
    loadTranscriptVisible(workspaceDir, sid),
  );
  const createdMs = Date.parse(session.createdAt) || 0;
  const updatedMs = Date.parse(session.updatedAt) || createdMs;
  const doc: IndexedConversation = {
    sessionId: sid,
    title,
    matterId: session.matterId,
    assistantId: session.assistantId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    createdMs,
    updatedMs,
    messages,
    haystack: haystackFor(title, messages),
  };
  if (indexCache.size > 512) {
    const oldest = indexCache.keys().next().value;
    if (oldest) {
      indexCache.delete(oldest);
    }
  }
  indexCache.set(key, { jsonMtime, jsonSize, trMtime, trSize, doc });
  return doc;
}

function matchesAssistant(doc: IndexedConversation, assistantId: string | undefined): boolean {
  const want = assistantId?.trim();
  if (!want) {
    return true;
  }
  if (doc.assistantId === want) {
    return true;
  }
  return !doc.assistantId && want === "default";
}

function activityTimes(doc: IndexedConversation): number[] {
  const out = [doc.createdMs, doc.updatedMs];
  for (const msg of doc.messages) {
    const t = Date.parse(msg.timestamp);
    if (Number.isFinite(t)) {
      out.push(t);
    }
  }
  return out;
}

function activityInWindow(doc: IndexedConversation, sinceMs?: number, untilMs?: number): boolean {
  if (sinceMs == null && untilMs == null) {
    return true;
  }
  return activityTimes(doc).some((t) => {
    if (sinceMs != null && t < sinceMs) {
      return false;
    }
    if (untilMs != null && t > untilMs) {
      return false;
    }
    return true;
  });
}

function allTermsPresent(haystack: string, title: string, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const titleLow = title.toLowerCase();
  return terms.every((term) => titleLow.includes(term) || haystack.includes(term));
}

function snippetAround(text: string, terms: string[]): string | undefined {
  const low = text.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const i = low.indexOf(term);
    if (i >= 0 && (best < 0 || i < best)) {
      best = i;
    }
  }
  if (best < 0) {
    return undefined;
  }
  const start = Math.max(0, best - 40);
  const slice = text
    .slice(start, start + SNIPPET_CHARS)
    .replace(/\s+/g, " ")
    .trim();
  if (!slice) {
    return undefined;
  }
  return start > 0 ? `…${slice}` : slice;
}

function collectSnippets(
  doc: IndexedConversation,
  terms: string[],
): Array<{ role: "user" | "assistant"; text: string }> {
  const out: Array<{ role: "user" | "assistant"; text: string }> = [];
  if (terms.length === 0) {
    const last = [...doc.messages].toReversed().find((m) => m.content.trim());
    if (last) {
      out.push({
        role: last.role,
        text: last.content.slice(0, SNIPPET_CHARS),
      });
    }
    return out;
  }
  for (const msg of doc.messages) {
    const snip = snippetAround(msg.content, terms);
    if (!snip) {
      continue;
    }
    out.push({ role: msg.role, text: snip });
    if (out.length >= MAX_SNIPPETS_PER_HIT) {
      break;
    }
  }
  if (out.length === 0) {
    const titleSnip = snippetAround(doc.title, terms);
    if (titleSnip) {
      out.push({ role: "user", text: titleSnip });
    }
  }
  return out;
}

function scoreDoc(
  doc: IndexedConversation,
  terms: string[],
  nowMs: number,
  windowBoost: boolean,
): number {
  let score = 0;
  const titleLow = doc.title.toLowerCase();
  for (const term of terms) {
    if (titleLow.includes(term)) {
      score += 8;
    }
    if (doc.haystack.includes(term)) {
      score += 2;
    }
  }
  const ageDays = Math.max(0, (nowMs - (doc.updatedMs || nowMs)) / 86_400_000);
  if (ageDays <= 3) {
    score += 3;
  } else if (ageDays <= 14) {
    score += 2;
  } else if (ageDays <= 45) {
    score += 1;
  }
  if (windowBoost) {
    score += 4;
  }
  return score;
}

export function searchConversations(
  workspaceDir: string,
  opts: ConversationSearchOpts,
): ConversationSearchResult {
  const parsed = parseConversationSearchQuery(opts.query ?? "");
  const nowMs = opts.nowMs ?? Date.now();
  const window = resolveConversationTimeWindow({
    parsed,
    since: opts.since,
    until: opts.until,
    days: opts.days,
    nowMs,
  });
  const terms = [...parsed.phrases, ...parsed.keywords];
  const explicitTime = Boolean(
    opts.since?.trim() ||
    opts.until?.trim() ||
    (typeof opts.days === "number" && Number.isFinite(opts.days) && opts.days > 0),
  );
  const hasWindow = window.sinceMs != null || window.untilMs != null;
  const timeMode: ConversationTimeMode = !hasWindow
    ? "none"
    : explicitTime || terms.length === 0
      ? "filter"
      : "boost";
  const emptyResult = (): ConversationSearchResult => ({
    query: (opts.query ?? "").trim(),
    keywords: parsed.keywords,
    phrases: parsed.phrases,
    since: window.since,
    until: window.until,
    timeMode,
    hits: [],
    scanned: 0,
  });
  // No keywords and no hard time window → do not dump "recent chats".
  if (terms.length === 0 && timeMode !== "filter") {
    return emptyResult();
  }
  const limit = Math.min(
    MAX_HIT_LIMIT,
    Math.max(
      1,
      Number.isFinite(opts.limit) ? Math.floor(opts.limit ?? DEFAULT_HIT_LIMIT) : DEFAULT_HIT_LIMIT,
    ),
  );
  const exclude = opts.excludeSessionId?.trim();
  const sessions = listSessions(workspaceDir).slice(0, MAX_SESSIONS_SCANNED);
  const hits: ConversationSearchHit[] = [];
  let scanned = 0;
  for (const session of sessions) {
    if (exclude && session.sessionId === exclude) {
      continue;
    }
    const doc = indexSession(workspaceDir, session);
    if (!matchesAssistant(doc, opts.assistantId)) {
      continue;
    }
    const inTime = activityInWindow(doc, window.sinceMs, window.untilMs);
    if (timeMode === "filter" && !inTime) {
      continue;
    }
    scanned += 1;
    if (terms.length > 0 && !allTermsPresent(doc.haystack, doc.title, terms)) {
      continue;
    }
    hits.push({
      sessionId: doc.sessionId,
      title: doc.title,
      matterId: doc.matterId,
      assistantId: doc.assistantId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      score: scoreDoc(doc, terms, nowMs, timeMode === "boost" && inTime),
      snippets: collectSnippets(doc, terms),
      citeAs: formatConversationCiteAs(doc.sessionId, doc.title, doc.assistantId),
    });
  }
  hits.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  return {
    query: (opts.query ?? "").trim(),
    keywords: parsed.keywords,
    phrases: parsed.phrases,
    since: window.since,
    until: window.until,
    timeMode,
    hits: hits.slice(0, limit),
    scanned,
  };
}

export type ReadConversationOpts = {
  sessionId: string;
  query?: string;
  limit?: number;
};

export type ReadConversationResult =
  | {
      ok: true;
      sessionId: string;
      title: string;
      matterId?: string;
      assistantId?: string;
      createdAt: string;
      updatedAt: string;
      citeAs: string;
      messages: ConversationVisibleMessage[];
      truncated: boolean;
      totalVisible: number;
    }
  | { ok: false; error: string };

function loadSessionFile(workspaceDir: string, sessionId: string): AgentSession | undefined {
  const fp = path.join(workspaceDir, "sessions", `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as AgentSession;
  } catch {
    return undefined;
  }
}

export function readConversation(
  workspaceDir: string,
  opts: ReadConversationOpts,
): ReadConversationResult {
  const sessionId = opts.sessionId.trim();
  if (!isSafeSessionId(sessionId)) {
    return { ok: false, error: "session_id 无效" };
  }
  const session = loadSessionFile(workspaceDir, sessionId);
  if (!session) {
    return { ok: false, error: "未找到该对话" };
  }
  const doc = indexSession(workspaceDir, session);
  const terms = parseConversationSearchQuery(opts.query ?? "");
  const needles = [...terms.phrases, ...terms.keywords];
  let messages = doc.messages;
  if (needles.length > 0) {
    const picked: ConversationVisibleMessage[] = [];
    const used = new Set<number>();
    for (let i = 0; i < doc.messages.length; i++) {
      const msg = doc.messages[i];
      const low = msg.content.toLowerCase();
      if (!needles.some((n) => low.includes(n))) {
        continue;
      }
      for (const j of [i - 1, i, i + 1]) {
        if (j < 0 || j >= doc.messages.length || used.has(j)) {
          continue;
        }
        used.add(j);
        picked.push(doc.messages[j]);
      }
    }
    if (picked.length > 0) {
      messages = picked;
    }
  }
  const cap = Math.min(
    MAX_READ_MESSAGES,
    Math.max(
      1,
      Number.isFinite(opts.limit)
        ? Math.floor(opts.limit ?? DEFAULT_READ_MESSAGES)
        : DEFAULT_READ_MESSAGES,
    ),
  );
  const sliced = messages.slice(-cap);
  let chars = 0;
  const clipped: ConversationVisibleMessage[] = [];
  for (const msg of sliced) {
    const content =
      msg.content.length > MAX_READ_MESSAGE_CHARS
        ? `${msg.content.slice(0, MAX_READ_MESSAGE_CHARS)}…`
        : msg.content;
    chars += content.length;
    if (chars > MAX_READ_CHARS && clipped.length > 0) {
      break;
    }
    clipped.push({ ...msg, content });
  }
  return {
    ok: true,
    sessionId: doc.sessionId,
    title: doc.title,
    matterId: doc.matterId,
    assistantId: doc.assistantId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    citeAs: formatConversationCiteAs(doc.sessionId, doc.title, doc.assistantId),
    messages: clipped,
    truncated: doc.messages.length > clipped.length,
    totalVisible: doc.messages.length,
  };
}
