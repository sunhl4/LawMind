import { describe, expect, it } from "vitest";
import {
  appendPinIdsToWorldState,
  collectWorldStateHashes,
  extractWorldStateSection,
  formatPermissionWorldState,
  hashWorldStateBody,
  stabilizeUnchangedWorldState,
  upsertWorldStateSection,
  wrapWorldStateSection,
} from "./world-state.js";

describe("world-state sections", () => {
  it("wraps, extracts, and upserts a section", () => {
    const wrapped = wrapWorldStateSection("pins", "  - pin-a  ");
    expect(wrapped).toContain("<!--lm-ws:pins-->");
    expect(extractWorldStateSection(wrapped, "pins")).toBe("- pin-a");

    const next = upsertWorldStateSection("static\n\n---\n\ntail", "craft", "红线仍有效");
    expect(extractWorldStateSection(next, "craft")).toBe("红线仍有效");
    const replaced = upsertWorldStateSection(next, "craft", "红线仍有效（更新）");
    expect(extractWorldStateSection(replaced, "craft")).toBe("红线仍有效（更新）");
    expect(replaced).toContain("static");
  });

  it("hashes trim-equivalent bodies the same", () => {
    expect(hashWorldStateBody("案件：m1")).toBe(hashWorldStateBody("  案件：m1\n"));
  });

  it("stabilizes unchanged sections from the previous system text", () => {
    const prev = [
      "HEAD",
      wrapWorldStateSection("pins", "- pin-a"),
      wrapWorldStateSection("permission", formatPermissionWorldState("strict")),
    ].join("\n\n");
    const assembled = [
      "HEAD",
      wrapWorldStateSection("pins", "- pin-a"),
      wrapWorldStateSection("permission", formatPermissionWorldState("strict") + " "),
    ].join("\n\n");
    const prevHashes = collectWorldStateHashes(prev);
    const nextHashes = collectWorldStateHashes(assembled);
    expect(prevHashes.pins).toBe(nextHashes.pins);
    const stable = stabilizeUnchangedWorldState(assembled, prev, prevHashes, nextHashes);
    expect(extractWorldStateSection(stable, "pins")).toBe("- pin-a");
    expect(stable).toContain(wrapWorldStateSection("pins", "- pin-a"));
  });

  it("appends pin ids without duplicating", () => {
    const once = appendPinIdsToWorldState("HEAD", ["pin-a", "pin-b"]);
    const twice = appendPinIdsToWorldState(once, ["pin-b", "pin-c"]);
    expect(extractWorldStateSection(twice, "pins")?.split("\n")).toEqual([
      "- pin-a",
      "- pin-b",
      "- pin-c",
    ]);
  });
});
