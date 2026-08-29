import { describe, expect, it } from "vitest";
import {
  applyCompactReinjectionToSession,
  COMPACT_REINJECTION_MARKER,
  formatCompactReinjectionBlock,
} from "./compact-reinjection.js";
import type { AgentSession } from "./types.js";

function baseSession(over?: Partial<AgentSession>): AgentSession {
  return {
    sessionId: "s1",
    actorId: "system",
    turns: [],
    conversationHistory: [
      {
        role: "system",
        content: "## RULES\n不要外发",
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("compact-reinjection", () => {
  it("formats marker and safety lines", () => {
    const block = formatCompactReinjectionBlock({ mandatoryRulesActive: true });
    expect(block).toContain(COMPACT_REINJECTION_MARKER);
    expect(block).toContain("RULES");
    expect(block).toContain("空修订不得导出");
  });

  it("applies to system message on same turn and clears flag", () => {
    const session = baseSession({ needsCompactReinjection: true });
    expect(applyCompactReinjectionToSession(session)).toBe(true);
    expect(session.conversationHistory[0]?.content).toContain(COMPACT_REINJECTION_MARKER);
    expect(session.conversationHistory[0]?.content).toContain("<!--lm-ws:craft-->");
    expect(session.conversationHistory[0]?.content).toContain("RULES");
    expect(session.worldStateBaseline?.craft).toBeTruthy();
    expect(session.worldStateEpoch).toBe(1);
    expect(session.needsCompactReinjection).toBe(false);
  });

  it("inserts 红线 before the last user and keeps the system prefix", () => {
    const session = baseSession({
      needsCompactReinjection: true,
      conversationHistory: [
        { role: "system", content: "STATIC_PREFIX", timestamp: new Date().toISOString() },
        { role: "user", content: "请继续改合同", timestamp: new Date().toISOString() },
      ],
    });
    expect(applyCompactReinjectionToSession(session)).toBe(true);
    expect(session.conversationHistory[0]?.content.startsWith("STATIC_PREFIX")).toBe(true);
    expect(session.conversationHistory[0]?.content).toContain("<!--lm-ws:craft-->");
    const last = session.conversationHistory[session.conversationHistory.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("请继续改合同");
    const before = session.conversationHistory[session.conversationHistory.length - 2];
    expect(before?.content).toContain(COMPACT_REINJECTION_MARKER);
  });

  it("inserts before last user even when system is missing", () => {
    const session = baseSession({
      needsCompactReinjection: true,
      conversationHistory: [{ role: "user", content: "hi", timestamp: new Date().toISOString() }],
    });
    expect(applyCompactReinjectionToSession(session)).toBe(true);
    expect(session.needsCompactReinjection).toBe(false);
    expect(session.conversationHistory[0]?.content).toContain(COMPACT_REINJECTION_MARKER);
    expect(session.conversationHistory[1]?.content).toBe("hi");
  });
});
