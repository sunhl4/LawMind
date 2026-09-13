import { describe, expect, it } from "vitest";
import {
  appendPinIdsToWorldState,
  applyPendingWorldStateCraftPatch,
  collectWorldStateHashes,
  extractWorldStateSection,
  formatPermissionWorldState,
  hashWorldStateBody,
  prependWorldStateCraft,
  stabilizeUnchangedWorldState,
  upsertWorldStateSection,
  wrapWorldStateSection,
  WORLD_STATE_SECTION_IDS,
  type WorldStateCraftHost,
} from "./world-state.js";

describe("world-state sections", () => {
  it("includes a named plan section for the turn checklist", () => {
    expect(WORLD_STATE_SECTION_IDS).toContain("plan");
  });

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

  it("formats XML environment_context instead of a Chinese essay", () => {
    const xml = formatPermissionWorldState("readonly");
    expect(xml).toContain("<permission_mode>readonly</permission_mode>");
    expect(xml).toContain("<write_tools>off</write_tools>");
    expect(xml).toContain("<os_sandbox>false</os_sandbox>");
    expect(formatPermissionWorldState("standard", { allowWebSearch: true })).toContain(
      "<network>web_search</network>",
    );
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

  it("prepends a craft warning fragment without duplicating", () => {
    const warning = "【改稿路径】请改走 apply_surgical_edits。";
    const first = prependWorldStateCraft("HEAD", warning);
    expect(extractWorldStateSection(first, "craft")).toBe(warning);
    const withExisting = prependWorldStateCraft(first, "压缩后红线仍有效");
    expect(extractWorldStateSection(withExisting, "craft")).toBe(`压缩后红线仍有效\n\n${warning}`);
    expect(prependWorldStateCraft(withExisting, warning)).toBe(withExisting);
  });

  it("consumes a pending craft patch onto the system message", () => {
    const session: WorldStateCraftHost = {
      conversationHistory: [{ role: "system", content: "STATIC" }],
      worldStateEpoch: 0,
    };
    const ctx: { pendingWorldStateCraftPatch?: string } = {
      pendingWorldStateCraftPatch: "【改稿路径】未写入。",
    };
    expect(applyPendingWorldStateCraftPatch(session, ctx)).toBe(true);
    expect(ctx.pendingWorldStateCraftPatch).toBeUndefined();
    expect(session.legacyUpdateDraftBodyWarning).toBe(true);
    expect(extractWorldStateSection(session.conversationHistory[0].content, "craft")).toBe(
      "【改稿路径】未写入。",
    );
    expect(session.worldStateEpoch).toBe(1);
    expect(applyPendingWorldStateCraftPatch(session, ctx)).toBe(false);
  });
});
