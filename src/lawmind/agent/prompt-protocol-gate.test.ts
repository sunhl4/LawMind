import { describe, expect, it } from "vitest";
import {
  RESEARCH_PROTOCOL_TOOLS,
  SURGICAL_PROTOCOL_TOOLS,
  toolsAllowAny,
} from "./prompt-protocol-gate.js";

describe("prompt-protocol-gate", () => {
  it("does not infer a tool lock when the name list is omitted", () => {
    expect(toolsAllowAny(undefined, RESEARCH_PROTOCOL_TOOLS)).toBe(true);
    expect(toolsAllowAny(["draft_document"], RESEARCH_PROTOCOL_TOOLS)).toBe(false);
    expect(toolsAllowAny(["search_statute", "draft_document"], RESEARCH_PROTOCOL_TOOLS)).toBe(true);
    expect(toolsAllowAny(["render_document"], SURGICAL_PROTOCOL_TOOLS)).toBe(false);
  });
});
