/**
 * citationMode — Skills epic E4.
 * grounded | assisted | off
 */

import type { DraftCitationIntegrityView } from "../drafts/citation-integrity.js";
import type { LawMindEdition } from "./workspace-policy.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

export type CitationMode = "grounded" | "assisted" | "off";

export function resolveCitationMode(
  policy: Pick<LawMindWorkspacePolicy, "citationMode"> | null | undefined,
  edition: LawMindEdition,
  envValue?: string | null,
): CitationMode {
  const fromEnv = (envValue ?? process.env.LAWMIND_CITATION_MODE ?? "").trim().toLowerCase();
  if (fromEnv === "grounded" || fromEnv === "assisted" || fromEnv === "off") {
    return fromEnv;
  }
  const fromPolicy = policy?.citationMode;
  if (fromPolicy === "grounded" || fromPolicy === "assisted" || fromPolicy === "off") {
    return fromPolicy;
  }
  if (edition === "private_deploy") {
    return "grounded";
  }
  if (edition === "firm") {
    return "assisted";
  }
  return "assisted";
}

/** Grounded: missing sources or unanchored long sections block strict render. */
export function citationModeBlocksRender(
  mode: CitationMode,
  integrity: DraftCitationIntegrityView | null | undefined,
): boolean {
  if (mode === "off") {
    return false;
  }
  if (!integrity || !integrity.checked) {
    return mode === "grounded";
  }
  if (!integrity.ok) {
    return mode === "grounded" || mode === "assisted";
  }
  if (mode === "grounded" && integrity.unanchoredSections.length > 0) {
    return true;
  }
  return false;
}

export function citationModeBannerKind(
  mode: CitationMode,
  integrity: DraftCitationIntegrityView | null | undefined,
): "skip" | "memory" | "pending" | "verified" | "danger" {
  if (mode === "off") {
    return "skip";
  }
  if (!integrity || !integrity.checked) {
    return mode === "grounded" ? "pending" : "memory";
  }
  if (!integrity.ok) {
    return "danger";
  }
  if (integrity.unanchoredSections.length > 0) {
    return mode === "grounded" ? "pending" : "verified";
  }
  return "verified";
}
