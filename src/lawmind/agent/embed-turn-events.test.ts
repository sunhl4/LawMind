import { describe, expect, it } from "vitest";
import {
  EMBED_TURN_EVENT_TYPES,
  embedSseEventName,
  LEGACY_FINAL_SSE_ALIAS,
  MAX_LIVE_TURN_STEPS,
} from "./embed-turn-events.js";

describe("embed-turn-events", () => {
  it("uses RunTurnEvent.type as the SSE name", () => {
    expect(embedSseEventName("final")).toBe("final");
    expect(embedSseEventName("round_start")).toBe("round_start");
    expect(LEGACY_FINAL_SSE_ALIAS).toBe("final_reply");
    expect(EMBED_TURN_EVENT_TYPES).toContain("requires_action");
    expect(MAX_LIVE_TURN_STEPS).toBe(80);
  });
});
