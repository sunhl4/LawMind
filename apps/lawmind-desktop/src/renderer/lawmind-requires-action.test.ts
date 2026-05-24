import { describe, expect, it } from "vitest";
import { parseRequiresActionsFromResponse } from "./lawmind-requires-action";

describe("parseRequiresActionsFromResponse", () => {
  it("parses valid requiresAction array", () => {
    const raw = [
      {
        id: "a1",
        kind: "tool_approval",
        threadId: "m:t:s",
        title: "批准",
        summary: "执行工具",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const out = parseRequiresActionsFromResponse(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("tool_approval");
  });

  it("returns empty for invalid entries", () => {
    expect(parseRequiresActionsFromResponse([{ id: 1 }])).toHaveLength(0);
    expect(parseRequiresActionsFromResponse(null)).toHaveLength(0);
  });
});
