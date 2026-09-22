import { describe, expect, it } from "vitest";
import {
  LEGACY_UPDATE_DRAFT_BODY_CODE,
  LEGACY_UPDATE_DRAFT_BODY_WARNING,
  LEGACY_UPDATE_DRAFT_CRAFT_MARKER,
  craftPatchFromToolResult,
  isLockedContractEditTurn,
  mergeLegacyUpdateDraftWarningIntoCraft,
  noteLegacyUpdateDraftBodyWarning,
  promoteLegacyUpdateDraftCraftPatch,
  shouldRejectLegacyUpdateDraftBody,
} from "./legacy-update-draft-warning.js";

describe("legacy update_draft body warning", () => {
  it("locks only mail/Word short-path turns", () => {
    expect(isLockedContractEditTurn({})).toBe(false);
    expect(isLockedContractEditTurn({ wordRevisionTurn: true })).toBe(true);
    expect(isLockedContractEditTurn({ mailContractTurn: true })).toBe(true);
  });

  it("rejects only when sections are sent on a locked turn", () => {
    expect(shouldRejectLegacyUpdateDraftBody({ sections: [{ heading: "a", body: "b" }] }, {})).toBe(
      false,
    );
    expect(shouldRejectLegacyUpdateDraftBody({}, { wordRevisionTurn: true })).toBe(false);
    expect(
      shouldRejectLegacyUpdateDraftBody(
        { sections: [{ heading: "a", body: "b" }] },
        { wordRevisionTurn: true },
      ),
    ).toBe(true);
    expect(shouldRejectLegacyUpdateDraftBody({ sections: [] }, { mailContractTurn: true })).toBe(
      true,
    );
  });

  it("notes the craft fragment onto ctx for the next model round", () => {
    const ctx: { pendingWorldStateCraftPatch?: string } = {};
    noteLegacyUpdateDraftBodyWarning(ctx);
    expect(ctx.pendingWorldStateCraftPatch).toBe(LEGACY_UPDATE_DRAFT_BODY_WARNING);
    expect(ctx.pendingWorldStateCraftPatch).toContain(LEGACY_UPDATE_DRAFT_CRAFT_MARKER);
  });

  it("promotes the patch onto the shared ctx after a timeout-middleware shallow copy", () => {
    const shared: { pendingWorldStateCraftPatch?: string } = {};
    const copy = { ...shared };
    noteLegacyUpdateDraftBodyWarning(copy);
    expect(shared.pendingWorldStateCraftPatch).toBeUndefined();
    promoteLegacyUpdateDraftCraftPatch(shared, {
      data: { code: LEGACY_UPDATE_DRAFT_BODY_CODE },
    });
    expect(shared.pendingWorldStateCraftPatch).toBe(LEGACY_UPDATE_DRAFT_BODY_WARNING);
    expect(craftPatchFromToolResult({ data: { code: "other" } })).toBeUndefined();
  });

  it("prepends once and does not duplicate", () => {
    const once = mergeLegacyUpdateDraftWarningIntoCraft("压缩后红线仍有效");
    expect(once.startsWith(LEGACY_UPDATE_DRAFT_CRAFT_MARKER)).toBe(true);
    expect(once).toContain("压缩后红线仍有效");
    expect(mergeLegacyUpdateDraftWarningIntoCraft(once)).toBe(once);
    expect(mergeLegacyUpdateDraftWarningIntoCraft("")).toBe(LEGACY_UPDATE_DRAFT_BODY_WARNING);
  });
});
