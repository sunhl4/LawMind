import { describe, expect, it } from "vitest";
import {
  clientHasLiveTurn,
  focusedSessionHasLiveTurn,
  reattachLiveTurn,
  runningSessionIds,
  sessionQueueKey,
  shouldDetachLiveTurn,
  turnStillOwnsComposer,
  type LiveTurn,
} from "./lawmind-live-turns";

function turn(partial: Partial<LiveTurn> & Pick<LiveTurn, "assistantId">): LiveTurn {
  return {
    boundSessionId: "s-a",
    userText: "办",
    abort: new AbortController(),
    uiDetached: false,
    rebind: false,
    ...partial,
  };
}

describe("live turns across conversations", () => {
  it("keeps the turn attached when the lawyer stays on that conversation", () => {
    const live = turn({ assistantId: "lawyer", boundSessionId: "s-a" });
    expect(shouldDetachLiveTurn(live, { assistantId: "lawyer", sessionId: "s-a" })).toBe(false);
    expect(
      focusedSessionHasLiveTurn([live], { assistantId: "lawyer", sessionId: "s-a" }),
    ).toBe(true);
  });

  it("detaches when opening another conversation, without treating the new one as busy", () => {
    const live = turn({ assistantId: "lawyer", boundSessionId: "s-a" });
    expect(shouldDetachLiveTurn(live, { assistantId: "lawyer", sessionId: "s-b" })).toBe(true);
    live.uiDetached = true;
    expect(
      focusedSessionHasLiveTurn([live], { assistantId: "lawyer", sessionId: "s-b" }),
    ).toBe(false);
    expect(
      focusedSessionHasLiveTurn([live], { assistantId: "lawyer", sessionId: "s-a" }),
    ).toBe(true);
  });

  it("detaches an unbound turn once a concrete session is opened", () => {
    const live = turn({ assistantId: "lawyer", boundSessionId: undefined });
    expect(shouldDetachLiveTurn(live, { assistantId: "lawyer", sessionId: undefined })).toBe(false);
    expect(shouldDetachLiveTurn(live, { assistantId: "lawyer", sessionId: "s-new" })).toBe(true);
  });

  it("lets several conversations run at once and only blocks the one on screen", () => {
    const turns = [
      turn({ assistantId: "lawyer", boundSessionId: "s1" }),
      turn({ assistantId: "lawyer", boundSessionId: "s2", uiDetached: true }),
      turn({ assistantId: "lawyer", boundSessionId: "s3", uiDetached: true }),
    ];
    expect(focusedSessionHasLiveTurn(turns, { assistantId: "lawyer", sessionId: "s1" })).toBe(true);
    expect(focusedSessionHasLiveTurn(turns, { assistantId: "lawyer", sessionId: "s4" })).toBe(false);
    expect(clientHasLiveTurn(turns, "s2")).toBe(true);
    expect(clientHasLiveTurn(turns, "s4")).toBe(false);
    expect([...runningSessionIds(turns)].toSorted()).toEqual(["s1", "s2", "s3"]);
    expect(reattachLiveTurn(turns, { assistantId: "lawyer", sessionId: "s3" })).toBe(true);
    expect(turns[2]?.uiDetached).toBe(false);
    expect(turns[2]?.rebind).toBe(true);
    expect(turns[1]?.uiDetached).toBe(true);
  });

  it("does not let a background turn clear the conversation now on screen", () => {
    const live = turn({ assistantId: "lawyer", boundSessionId: "s-a" });
    expect(
      turnStillOwnsComposer(live, { assistantId: "lawyer", sessionId: "s-a" }),
    ).toBe(true);
    expect(
      turnStillOwnsComposer(live, { assistantId: "lawyer", sessionId: "s-b" }),
    ).toBe(false);
    expect(
      turnStillOwnsComposer(live, { assistantId: "other", sessionId: "s-a" }),
    ).toBe(false);
  });

  it("keys follow-ups by session so a new conversation does not inherit the queue", () => {
    expect(sessionQueueKey("s-a", "lawyer")).toBe("s-a");
    expect(sessionQueueKey(undefined, "lawyer")).toBe("pending:lawyer");
    expect(sessionQueueKey("  ", "lawyer")).toBe("pending:lawyer");
  });
});
