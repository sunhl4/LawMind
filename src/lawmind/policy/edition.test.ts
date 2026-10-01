import { describe, expect, it } from "vitest";
import {
  EDITION_FEATURES,
  EDITION_LABELS,
  isFeatureEnabled,
  listEditions,
  normalizeEdition,
  resolveEdition,
  soloEditionFeatures,
} from "./edition.js";

describe("policy/edition", () => {
  it("falls back to solo when no policy and no env hint", () => {
    const ctx = resolveEdition({ policy: null, env: {} });
    expect(ctx.edition).toBe("solo");
    expect(ctx.source).toBe("default");
    expect(ctx.label).toBe(EDITION_LABELS.solo);
    expect(ctx.features).toEqual(soloEditionFeatures());
    expect(ctx.features.strictDangerousToolApproval).toBe(false);
    expect(ctx.features.matterReplicaCollab).toBe(true);
    expect(ctx.features.ethicsWall).toBe(false);
    expect(ctx.features.customDeliverableSpec).toBe(true);
    expect(ctx.features.wordAddinAutoRun).toBe(true);
    expect(ctx.features.guardianTrackedRedlineBlock).toBe(false);
  });

  it("respects LAWMIND_EDITION env when policy is missing", () => {
    const ctx = resolveEdition({ policy: null, env: { LAWMIND_EDITION: "FIRM" } });
    expect(ctx.edition).toBe("firm");
    expect(ctx.source).toBe("env");
    expect(ctx.features.strictDangerousToolApproval).toBe(true);
    expect(ctx.features.matterReplicaCollab).toBe(true);
    expect(ctx.features.ethicsWall).toBe(true);
    expect(ctx.features.wordAddinAutoRun).toBe(false);
    expect(ctx.features.guardianTrackedRedlineBlock).toBe(true);
  });

  it("policy file overrides env (case-insensitive edition)", () => {
    const ctx = resolveEdition({
      policy: { schemaVersion: 1, edition: "Private_Deploy" } as never,
      env: { LAWMIND_EDITION: "solo" },
    });
    expect(ctx.edition).toBe("private_deploy");
    expect(ctx.source).toBe("policy_file");
    expect(ctx.features.complianceAuditExport).toBe(true);
    expect(ctx.features.securitySbomPanel).toBe(true);
  });

  it("does not let policy.features turn edition floors off", () => {
    expect(
      isFeatureEnabled("complianceAuditExport", {
        policy: { schemaVersion: 1, edition: "solo", features: { complianceAuditExport: true } },
      }),
    ).toBe(false);
    expect(
      isFeatureEnabled("acceptanceGateStrict", {
        policy: { schemaVersion: 1, edition: "solo", features: { acceptanceGateStrict: false } },
      }),
    ).toBe(true);
  });

  it("ignores invalid edition strings", () => {
    const ctx = resolveEdition({ policy: null, env: { LAWMIND_EDITION: "enterprise_xl" } });
    expect(ctx.edition).toBe("solo");
    expect(ctx.source).toBe("default");
  });

  it("does not accept build-channel words as an edition", () => {
    expect(normalizeEdition("commercial")).toBeUndefined();
    expect(normalizeEdition("oss")).toBeUndefined();
    const fromEnv = resolveEdition({ policy: null, env: { LAWMIND_EDITION: "commercial" } });
    expect(fromEnv.edition).toBe("solo");
    expect(fromEnv.features.complianceAuditExport).toBe(false);
    const fromPolicy = resolveEdition({
      policy: { schemaVersion: 1, edition: "commercial" } as never,
      env: { LAWMIND_EDITION: "firm" },
    });
    expect(fromPolicy.edition).toBe("firm");
    expect(fromPolicy.source).toBe("env");
  });

  it("normalizeEdition accepts mixed case", () => {
    expect(normalizeEdition("Firm")).toBe("firm");
    expect(normalizeEdition(" SOLO ")).toBe("solo");
    expect(normalizeEdition("nope")).toBeUndefined();
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

  it("solo keeps firm governance walls off but leaves colleague invites on", () => {
    const solo = soloEditionFeatures();
    expect(solo.forcePeerReview).toBe(false);
    expect(solo.matterReplicaCollab).toBe(true);
    expect(solo.ethicsWall).toBe(false);
    expect(solo.strictDangerousToolApproval).toBe(false);
    expect(solo.complianceAuditExport).toBe(false);
    expect(solo.securitySbomPanel).toBe(false);
    expect(solo.multiAssistantRoster).toBe(false);
  });

  it("firm enables multi-assistant roster packaging", () => {
    expect(EDITION_FEATURES.multiAssistantRoster.firm).toBe(true);
    expect(EDITION_FEATURES.multiAssistantRoster.private_deploy).toBe(true);
  });
});
