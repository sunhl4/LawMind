/**
 * Edition feature gating — Solo / Firm / Private Deploy.
 *
 * Deliverable-First Architecture P4:
 *   Same code + workspace; `Edition` gates which panels / capabilities / checks / exports
 *   are visible or usable for the current user.
 *
 * Design (Solo-first, Cursor/Codex-style local-first tiers):
 *   1. Single source of truth: `policy.edition` > `LAWMIND_EDITION` > default `solo`
 *      (never errors; there is no "license missing" state for this table).
 *   2. Solo gets every capability an individual lawyer can use, including inviting
 *      a colleague onto one matter. Firm/private add governance walls and org packaging.
 *   3. Edition does not change data shapes; any edition can read any workspace.
 *   4. Feature keys live in browser-safe `edition-features.ts` (UI + engine share).
 *   5. Edition table is the feature contract. `policy.features` is not applied.
 *   6. License file edition is advisory / soft-gate only — it does not drive this table.
 */

import {
  EDITION_LABELS,
  EDITION_VALUES,
  featuresForEdition,
  normalizeEdition,
  type EditionFeatureKey,
  type LawMindEdition,
} from "./edition-features.js";
import { resolveEgressMode } from "./workspace-policy.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

export {
  EDITION_FEATURES,
  EDITION_LABELS,
  EDITION_VALUES,
  featuresForEdition,
  normalizeEdition,
  soloEditionFeatures,
  type EditionFeatureKey,
  type LawMindEdition,
} from "./edition-features.js";

/** Resolved edition + metadata (for `/api/health` / settings). */
export type EditionContext = {
  edition: LawMindEdition;
  label: string;
  source: "policy_file" | "env" | "default";
  features: Readonly<Record<EditionFeatureKey, boolean>>;
};

/**
 * Resolve the active edition.
 * Priority: policy.edition > LAWMIND_EDITION env > "solo".
 * Policy / env strings are case-insensitive (`Firm` / `FIRM` → firm).
 */
export function resolveEdition(opts?: {
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): EditionContext {
  const policy = opts?.policy;
  const env = opts?.env ?? process.env;

  let edition: LawMindEdition = "solo";
  let source: EditionContext["source"] = "default";

  const fromPolicy = normalizeEdition(policy?.edition);
  if (fromPolicy) {
    edition = fromPolicy;
    source = "policy_file";
  } else {
    const fromEnv = normalizeEdition(env.LAWMIND_EDITION);
    if (fromEnv) {
      edition = fromEnv;
      source = "env";
    }
  }

  const features = featuresForEdition(edition);

  return {
    edition,
    label: EDITION_LABELS[edition],
    source,
    features,
  };
}

/**
 * Single-feature query. Prefer this (or a dedicated resolver below) over reading
 * `EDITION_FEATURES[k][edition]` so policy overrides apply.
 *
 * Note: keys with dedicated policy surfaces still have companion helpers
 * (`isWordAddinAutoRunEnabled`, `isEthicsWallEnabled`, …) that apply those keys first.
 */
export function isFeatureEnabled(
  feature: EditionFeatureKey,
  opts?: { policy?: LawMindWorkspacePolicy | null; env?: NodeJS.ProcessEnv },
): boolean {
  return resolveEdition(opts).features[feature];
}

/** All valid edition strings (schema / settings enums). */
export function listEditions(): ReadonlyArray<LawMindEdition> {
  return EDITION_VALUES;
}

/**
 * W10: whether to collect product insight events (ux.matter_action).
 *
 * Resolve order:
 *   0. `egressMode: "offline"` (incl. legacy `highSecurityMode: true`) => force "off"
 *   1. policy.productInsightsCollection ("off" | "local-only" | "synced")
 *   2. default: solo => "local-only"; firm / private_deploy => "off"（不默认同步）
 */
export function resolveProductInsightsCollection(opts?: {
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): "off" | "local-only" | "synced" {
  if (resolveEgressMode(opts?.policy) === "offline") {
    return "off";
  }
  const explicit = opts?.policy?.productInsightsCollection;
  if (explicit === "off" || explicit === "local-only" || explicit === "synced") {
    return explicit;
  }
  const ctx = resolveEdition(opts);
  return ctx.edition === "solo" ? "local-only" : "off";
}

export function isProductInsightsCollectionEnabled(opts?: {
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return resolveProductInsightsCollection(opts) !== "off";
}

/**
 * Word add-in "审这份" auto-run.
 *
 * Order: `policy.wordAddinAutoRun` > `policy.features.wordAddinAutoRun` > edition table
 * (solo default on; firm / private_deploy default off).
 */
export function isWordAddinAutoRunEnabled(opts?: {
  policy?: LawMindWorkspacePolicy | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const explicit = opts?.policy?.wordAddinAutoRun;
  if (typeof explicit === "boolean") {
    return explicit;
  }
  return resolveEdition(opts).features.wordAddinAutoRun;
}
