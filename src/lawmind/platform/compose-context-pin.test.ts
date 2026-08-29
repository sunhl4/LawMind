import { describe, expect, it } from "vitest";
import {
  buildContextPinsPayload,
  encodeFileContextPin,
  makeContextPinId,
  normalizeContextPin,
  parseContextPins,
} from "./compose-context-pin.js";

describe("compose-context-pin", () => {
  it("normalizes legacy file pins", () => {
    expect(normalizeContextPin({ root: "workspace", relPath: "MEMORY.md", kind: "file" })).toEqual({
      pinKind: "file",
      root: "workspace",
      relPath: "MEMORY.md",
      kind: "file",
    });
  });

  it("parses typed truth-source pins", () => {
    const parsed = parseContextPins([
      { pinKind: "theory", matterId: "matter-001" },
      { pinKind: "playbook", playbookId: "standard-contract-review" },
      { pinKind: "clause", scope: "full" },
      { pinKind: "evidence", matterId: "matter-001", relPath: "contracts/main.pdf" },
    ]);
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) {
      return;
    }
    expect(parsed).toHaveLength(4);
    expect(parsed.map((p) => p.pinKind)).toEqual(["theory", "playbook", "clause", "evidence"]);
  });

  it("rejects invalid pins", () => {
    expect(parseContextPins({})).toEqual({ error: "contextPins must be an array" });
    expect(parseContextPins([{ pinKind: "theory", matterId: "../bad" }])).toEqual({
      error: "invalid context pin entry",
    });
    expect(parseContextPins([{ pinKind: "clause", scope: "section" }])).toEqual({
      error: "invalid context pin entry",
    });
  });

  it("builds deduped payload from files and truth pins", () => {
    const payload = buildContextPinsPayload({
      filePins: [{ root: "workspace", relPath: "a.md", kind: "file" }],
      truthPins: [
        { pinKind: "theory", matterId: "matter-001" },
        { pinKind: "theory", matterId: "matter-001" },
      ],
    });
    expect(payload).toHaveLength(2);
    expect(
      makeContextPinId(encodeFileContextPin({ root: "workspace", relPath: "a.md", kind: "file" })),
    ).toBe("file:workspace|file|a.md");
  });
});
