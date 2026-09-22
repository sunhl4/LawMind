import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendTranscriptLines } from "../adapters/session-transcript/index.js";
import {
  conversationSessionRefsFromToolData,
  parseConversationSearchQuery,
  readConversation,
  resolveRelativeTimeWindow,
  searchConversations,
} from "./conversation-search.js";
import { createSession, saveSession } from "./session.js";
import type { AgentSession } from "./types.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-search-"));
}

function writeSession(ws: string, session: AgentSession): void {
  const dir = path.join(ws, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${session.sessionId}.json`), JSON.stringify(session), "utf8");
}

function addVisible(
  session: AgentSession,
  role: "user" | "assistant",
  content: string,
  timestamp: string,
): void {
  session.conversationHistory.push({ role, content, timestamp });
}

describe("parseConversationSearchQuery", () => {
  it("strips 上周 and keeps short AND keywords", () => {
    const parsed = parseConversationSearchQuery("上周那个合同审查的要点");
    expect(parsed.relative?.kind).toBe("last_week");
    expect(parsed.keywords).toEqual(["合同审查"]);
    expect(parsed.keywords).not.toContain("上周");
    expect(parsed.keywords).not.toContain("要点");
  });

  it("keeps quoted phrases as exact terms", () => {
    const parsed = parseConversationSearchQuery('合同 "违约金上限"');
    expect(parsed.keywords).toContain("合同");
    expect(parsed.phrases).toContain("违约金上限");
  });

  it("keeps the three longest keywords when the query is noisy", () => {
    const parsed = parseConversationSearchQuery("合同审查 违约金上限 管辖法院 保密协议 仲裁时效");
    expect(parsed.keywords).toHaveLength(3);
    expect(parsed.keywords).toContain("违约金上限");
  });
});

describe("searchConversations", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("finds another chat by AND keywords and skips the current session", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const current = createSession({ workspaceDir: ws, actorId: "a", title: "当前对话" });
    addVisible(current, "user", "随便问问", "2026-09-14T10:00:00.000Z");
    writeSession(ws, current);

    const past = createSession({ workspaceDir: ws, actorId: "a", title: "采购合同审查" });
    past.updatedAt = "2026-09-08T04:00:00.000Z";
    addVisible(past, "user", "审查这份采购合同，重点看违约金上限", "2026-09-08T03:00:00.000Z");
    addVisible(
      past,
      "assistant",
      "建议把违约金上限改成合同总额的 20%。",
      "2026-09-08T03:01:00.000Z",
    );
    writeSession(ws, past);

    const other = createSession({ workspaceDir: ws, actorId: "a", title: "劳动仲裁时效" });
    addVisible(other, "user", "仲裁时效怎么算", "2026-09-10T02:00:00.000Z");
    writeSession(ws, other);

    const result = searchConversations(ws, {
      query: "合同 违约金",
      excludeSessionId: current.sessionId,
    });
    expect(result.hits.map((h) => h.sessionId)).toEqual([past.sessionId]);
    expect(result.hits[0]?.title).toContain("采购合同");
    expect(result.hits[0]?.citeAs).toContain(`lm-session:${past.sessionId}`);
    expect(result.hits[0]?.citeAs.startsWith("[")).toBe(true);
    expect(result.hits[0]?.snippets.some((s) => s.text.includes("违约金"))).toBe(true);
  });

  it("respects 上周 relative to a local Monday", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const monday = new Date(2026, 8, 14, 12, 0, 0);
    const lastWed = new Date(2026, 8, 9, 10, 0, 0);
    const mondayMorning = new Date(2026, 8, 14, 8, 0, 0);

    const lastWeek = createSession({ workspaceDir: ws, actorId: "a", title: "上周合同要点" });
    lastWeek.createdAt = lastWed.toISOString();
    lastWeek.updatedAt = lastWed.toISOString();
    addVisible(lastWeek, "user", "合同审查要点是管辖条款", lastWed.toISOString());
    writeSession(ws, lastWeek);

    const thisWeek = createSession({ workspaceDir: ws, actorId: "a", title: "本周闲聊" });
    thisWeek.createdAt = mondayMorning.toISOString();
    thisWeek.updatedAt = mondayMorning.toISOString();
    addVisible(thisWeek, "user", "合同审查要点再问一次", mondayMorning.toISOString());
    writeSession(ws, thisWeek);

    const win = resolveRelativeTimeWindow("last_week", monday.getTime());
    expect(lastWed.getTime()).toBeGreaterThanOrEqual(win.sinceMs);
    expect(lastWed.getTime()).toBeLessThanOrEqual(win.untilMs);
    expect(mondayMorning.getTime()).toBeGreaterThan(win.untilMs);

    const result = searchConversations(ws, {
      query: "上周 合同审查",
      nowMs: monday.getTime(),
    });
    expect(result.timeMode).toBe("boost");
    expect(result.hits.map((h) => h.sessionId)).toContain(lastWeek.sessionId);
    expect(result.hits[0]?.sessionId).toBe(lastWeek.sessionId);
  });

  it("still finds last-week work after the chat was saved today", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const monday = new Date(2026, 8, 14, 12, 0, 0);
    const lastWed = new Date(2026, 8, 9, 10, 0, 0);

    const past = createSession({ workspaceDir: ws, actorId: "a", title: "采购合同审查" });
    past.createdAt = lastWed.toISOString();
    past.updatedAt = monday.toISOString();
    addVisible(past, "user", "审查这份采购合同，重点看管辖和违约金", lastWed.toISOString());
    writeSession(ws, past);

    const result = searchConversations(ws, {
      query: "上周那个合同审查的要点",
      nowMs: monday.getTime(),
    });
    expect(result.timeMode).toBe("boost");
    expect(result.hits.map((h) => h.sessionId)).toContain(past.sessionId);
  });

  it("hard-filters when days is explicit", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const monday = new Date(2026, 8, 14, 12, 0, 0);
    const lastWed = new Date(2026, 8, 9, 10, 0, 0);

    const past = createSession({ workspaceDir: ws, actorId: "a", title: "采购合同审查" });
    past.createdAt = lastWed.toISOString();
    past.updatedAt = lastWed.toISOString();
    addVisible(past, "user", "审查这份采购合同", lastWed.toISOString());
    writeSession(ws, past);

    const result = searchConversations(ws, {
      query: "合同审查",
      days: 1,
      nowMs: monday.getTime(),
    });
    expect(result.timeMode).toBe("filter");
    expect(result.hits.map((h) => h.sessionId)).not.toContain(past.sessionId);
  });

  it("treats a bare 上周 as a hard window", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const monday = new Date(2026, 8, 14, 12, 0, 0);
    const lastWed = new Date(2026, 8, 9, 10, 0, 0);
    const mondayMorning = new Date(2026, 8, 14, 8, 0, 0);

    const lastWeek = createSession({ workspaceDir: ws, actorId: "a", title: "上周合同要点" });
    lastWeek.createdAt = lastWed.toISOString();
    lastWeek.updatedAt = lastWed.toISOString();
    addVisible(lastWeek, "user", "合同审查要点是管辖条款", lastWed.toISOString());
    writeSession(ws, lastWeek);

    const thisWeek = createSession({ workspaceDir: ws, actorId: "a", title: "本周闲聊" });
    thisWeek.createdAt = mondayMorning.toISOString();
    thisWeek.updatedAt = mondayMorning.toISOString();
    addVisible(thisWeek, "user", "合同审查要点再问一次", mondayMorning.toISOString());
    writeSession(ws, thisWeek);

    const result = searchConversations(ws, {
      query: "上周",
      nowMs: monday.getTime(),
    });
    expect(result.timeMode).toBe("filter");
    expect(result.hits.map((h) => h.sessionId)).toContain(lastWeek.sessionId);
    expect(result.hits.map((h) => h.sessionId)).not.toContain(thisWeek.sessionId);
  });

  it("matches compacted history via transcript jsonl", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const session = createSession({ workspaceDir: ws, actorId: "a", title: "旧审查" });
    session.conversationHistory = [
      {
        role: "user",
        content: "今天继续",
        timestamp: "2026-09-14T01:00:00.000Z",
      },
    ];
    saveSession(ws, session);
    appendTranscriptLines(ws, session.sessionId, [
      {
        role: "user",
        content: "对方坚持把保密期限写成五年，我们上次说最多三年",
        timestamp: "2026-09-01T01:00:00.000Z",
      },
      {
        role: "assistant",
        content: "保密期限按三年谈，超过三年改为终止后自动届满。",
        timestamp: "2026-09-01T01:01:00.000Z",
      },
    ]);

    const result = searchConversations(ws, { query: "保密期限 三年" });
    expect(result.hits.map((h) => h.sessionId)).toContain(session.sessionId);
  });

  it("does not dump recent chats when only stop words remain", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const past = createSession({ workspaceDir: ws, actorId: "a", title: "随便聊聊" });
    addVisible(past, "user", "今天天气不错", "2026-09-14T01:00:00.000Z");
    writeSession(ws, past);

    const result = searchConversations(ws, { query: "那个 一下" });
    expect(result.timeMode).toBe("none");
    expect(result.hits).toEqual([]);
  });

  it("truncates long titles in citeAs so markdown stays clickable", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const longTitle = `采购合同审查${"要点".repeat(60)}`;
    const past = createSession({ workspaceDir: ws, actorId: "a", title: longTitle });
    past.assistantId = "asst-contract";
    addVisible(past, "user", "看违约金", "2026-09-08T01:00:00.000Z");
    writeSession(ws, past);

    const result = searchConversations(ws, { query: "违约金" });
    const cite = result.hits[0]?.citeAs ?? "";
    expect(cite).toContain(`lm-session:${past.sessionId}?a=asst-contract`);
    const label = /^\[([^\]]+)\]/.exec(cite)?.[1] ?? "";
    expect(label.length).toBeLessThanOrEqual(80);
  });
});

describe("readConversation", () => {
  it("returns focused messages for a query and rejects path-like ids", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-conv-read-"));
    try {
      const session = createSession({ workspaceDir: ws, actorId: "a", title: "改稿做法" });
      addVisible(session, "user", "用最小修改改管辖条款", "2026-09-02T01:00:00.000Z");
      addVisible(
        session,
        "assistant",
        "只改该句管辖法院，不要重写整段。",
        "2026-09-02T01:01:00.000Z",
      );
      addVisible(session, "user", "再问时效", "2026-09-02T01:02:00.000Z");
      saveSession(ws, session);

      const hit = readConversation(ws, { sessionId: session.sessionId, query: "管辖" });
      expect(hit.ok).toBe(true);
      if (hit.ok) {
        expect(hit.messages.some((m) => m.content.includes("管辖"))).toBe(true);
        expect(hit.title).toBe("改稿做法");
        expect(hit.citeAs).toContain(`lm-session:${session.sessionId}`);
        expect(hit.citeAs).toContain("改稿做法");
      }
      expect(readConversation(ws, { sessionId: "../etc/passwd" }).ok).toBe(false);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("conversationSessionRefsFromToolData", () => {
  it("keeps search hits and read results, drops unsafe ids", () => {
    expect(
      conversationSessionRefsFromToolData("search_conversations", {
        hits: [
          { sessionId: "s1", title: "采购合同审查" },
          { sessionId: "../etc/passwd", title: "坏" },
          { sessionId: "s1", title: "重复" },
        ],
      }),
    ).toEqual([{ sessionId: "s1", title: "采购合同审查" }]);
    expect(
      conversationSessionRefsFromToolData("read_conversation", {
        sessionId: "s2",
        title: "改稿做法",
        matterId: "m1",
      }),
    ).toEqual([{ sessionId: "s2", title: "改稿做法", matterId: "m1" }]);
    expect(
      conversationSessionRefsFromToolData("search_matter", { hits: [{ sessionId: "s1" }] }),
    ).toEqual([]);
  });
});
