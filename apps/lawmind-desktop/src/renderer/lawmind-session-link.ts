/**
 * Lawyer-clickable cites for other LawMind chats.
 * Scheme is local-only: `[标题](lm-session:<sessionId>)` or
 * `[标题](lm-session:<sessionId>?a=<assistantId>)`.
 * Keep the id regex aligned with `src/lawmind/agent/conversation-search.ts`.
 */

export const LM_SESSION_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
export const LM_SESSION_LABEL_MAX = 200;

export type LmSessionLink = {
  sessionId: string;
  label: string;
  assistantId?: string;
};

export type ChatSessionRef = {
  sessionId: string;
  title: string;
  matterId?: string;
  assistantId?: string;
};

export function isSafeLmSessionId(raw: string): boolean {
  const id = raw.trim();
  return LM_SESSION_ID_RE.test(id) && !id.includes("..");
}

export function parseLmSessionHref(href: string): LmSessionLink | null {
  const raw = href.trim();
  const m =
    /^lm-session:([A-Za-z0-9._-]{1,80})(?:\?a=([A-Za-z0-9._-]{1,80}))?$/i.exec(raw);
  if (!m) {
    return null;
  }
  const sessionId = m[1] ?? "";
  if (!isSafeLmSessionId(sessionId)) {
    return null;
  }
  const assistantId = m[2]?.trim();
  return {
    sessionId,
    label: sessionId,
    ...(assistantId && isSafeLmSessionId(assistantId) ? { assistantId } : {}),
  };
}

export function tryConsumeLmSessionMarkdown(
  text: string,
  start: number,
): { link: LmSessionLink; next: number } | null {
  if (text[start] !== "[") {
    return null;
  }
  const close = text.indexOf("](lm-session:", start + 1);
  if (close < 0 || close === start + 1) {
    return null;
  }
  const label = text.slice(start + 1, close).trim();
  if (!label || label.includes("\n") || label.length > LM_SESSION_LABEL_MAX) {
    return null;
  }
  const hrefStart = close + 2;
  const hrefEnd = text.indexOf(")", hrefStart);
  if (hrefEnd < 0) {
    return null;
  }
  const parsed = parseLmSessionHref(text.slice(hrefStart, hrefEnd));
  if (!parsed) {
    return null;
  }
  return {
    link: {
      sessionId: parsed.sessionId,
      label,
      ...(parsed.assistantId ? { assistantId: parsed.assistantId } : {}),
    },
    next: hrefEnd + 1,
  };
}

export function sanitizeChatSessionRefs(raw: unknown): ChatSessionRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ChatSessionRef[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const sessionId = typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
    if (!isSafeLmSessionId(sessionId) || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    const title = typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : sessionId;
    const matterId = typeof rec.matterId === "string" ? rec.matterId.trim() : "";
    const assistantId = typeof rec.assistantId === "string" ? rec.assistantId.trim() : "";
    out.push({
      sessionId,
      title,
      ...(matterId ? { matterId } : {}),
      ...(assistantId && isSafeLmSessionId(assistantId) ? { assistantId } : {}),
    });
  }
  return out;
}
