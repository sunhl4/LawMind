import { describe, expect, it } from "vitest";
import {
  EDITION_FEATURES,
  EDITION_LABELS,
  isFeatureEnabled,
  listEditions,
  resolveEdition,
} from "./edition.js";

describe("policy/edition", () => {
  it("falls back to solo when no policy and no env hint", () => {
    const ctx = resolveEdition({ policy: null, env: {} });
    expect(ctx.edition).toBe("solo");
    expect(ctx.source).toBe("default");
    expect(ctx.label).toBe(EDITION_LABELS.solo);
    expect(ctx.features.acceptanceGateStrict).toBe(false);
    expect(ctx.features.strictDangerousToolApproval).toBe(false);
  });

  it("respects LAWMIND_EDITION env when policy is missing", () => {
    const ctx = resolveEdition({ policy: null, env: { LAWMIND_EDITION: "FIRM" } });
    expect(ctx.edition).toBe("firm");
    expect(ctx.source).toBe("env");
    expect(ctx.features.acceptanceGateStrict).toBe(true);
    expect(ctx.features.collaborationSummary).toBe(true);
    expect(ctx.features.strictDangerousToolApproval).toBe(true);
  });

  it("policy file overrides env", () => {
    const ctx = resolveEdition({
      policy: { schemaVersion: 1, edition: "private_deploy" },
      env: { LAWMIND_EDITION: "solo" },
    });
    expect(ctx.edition).toBe("private_deploy");
    expect(ctx.source).toBe("policy_file");
    expect(ctx.features.complianceAuditExport).toBe(true);
    expect(ctx.features.securitySbomPanel).toBe(true);
  });

  it("ignores invalid edition strings", () => {
    const ctx = resolveEdition({ policy: null, env: { LAWMIND_EDITION: "enterprise_xl" } });
    expect(ctx.edition).toBe("solo");
    expect(ctx.source).toBe("default");
  });

  it("isFeatureEnabled reflects feature table", () => {
    expect(
      isFeatureEnabled("acceptanceGateStrict", {
        policy: { schemaVersion: 1, edition: "solo" },
      }),
    ).toBe(false);
    expect(
      isFeatureEnabled("acceptanceGateStrict", {
        policy: { schemaVersion: 1, edition: "firm" },
      }),
    ).toBe(true);
  });

  it("listEditions exposes all known editions", () => {
    expect(listEditions()).toEqual(["solo", "firm", "private_deploy"]);
  });

  it("every feature has a value for every edition (no orphans)", () => {
    for (const key of Object.keys(EDITION_FEATURES)) {
      const row = EDITION_FEATURES[key as keyof typeof EDITION_FEATURES];
      expect(typeof row.solo).toBe("boolean");
      expect(typeof row.firm).toBe("boolean");
      expect(typeof row.private_deploy).toBe("boolean");
    }
  });

  it("private_deploy is a strict superset of firm", () => {
    for (const key of Object.keys(EDITION_FEATURES) as Array<keyof typeof EDITION_FEATURES>) {
      const row = EDITION_FEATURES[key];
      if (row.firm) {
        expect(row.private_deploy, `feature ${key} must stay enabled in private_deploy`).toBe(true);
      }
    }
  });
});
