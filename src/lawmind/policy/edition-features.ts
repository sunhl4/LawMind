/**
 * Edition feature table — browser-safe (no node: imports).
 *
 * Desktop renderer may import this module so UI defaults stay in lockstep with
 * the engine table. Runtime resolution (policy / env) lives in `edition.ts`.
 *
 * Product posture (Solo-first, aligned with Cursor/Codex local-first tiers):
 * - Solo gets every capability that a single lawyer can use alone.
 * - Firm / private_deploy add multi-lawyer governance walls and org packaging.
 * - `LAWMIND_BUILD_CHANNEL` (oss|commercial) is a process-start stamp, not this table.
 */

export type LawMindEdition = "solo" | "firm" | "private_deploy";

export const EDITION_VALUES: ReadonlyArray<LawMindEdition> = ["solo", "firm", "private_deploy"];

/** Human labels for settings / status strip. */
export const EDITION_LABELS: Readonly<Record<LawMindEdition, string>> = {
  solo: "独立律师版",
  firm: "律所协作版",
  private_deploy: "私有化部署版",
};

/**
 * Feature flag table. Add new capabilities **only** here.
 * `true` = default on for that edition; `false` = hidden or disabled by default.
 *
 * Solo-first rule: a single lawyer, or two lawyers each on their own app,
 * can use a capability without a firm purchase — default it on for `solo`.
 * Firm/private-only rows are reserved for governance walls and org packaging
 * (ethics wall, forced peer review, compliance export), not for inviting a colleague.
 */
export const EDITION_FEATURES = {
  /**
   * Acceptance gate strict: block render when checklist / reasoning not ready.
   * Universal delivery floor — all editions on. Trial can override via `policy.features`.
   */
  acceptanceGateStrict: { solo: true, firm: true, private_deploy: true },
  /**
   * Citation integrity hard gate when a research snapshot exists.
   * Universal delivery floor — all editions on.
   */
  citationGateStrict: { solo: true, firm: true, private_deploy: true },
  /** Cross-matter roadmap / experiment cards (useful for solo multi-matter desks). */
  crossMatterRoadmap: { solo: true, firm: true, private_deploy: true },
  /** Workspace-level acceptance readiness overview. */
  crossMatterAcceptanceDashboard: { solo: true, firm: true, private_deploy: true },
  /** Compliance audit export (`compliance=true`) — org packaging for private deploy. */
  complianceAuditExport: { solo: false, firm: false, private_deploy: true },
  /**
   * Audit JSONL hash-chain verify export (`integrity=true`).
   * Solo on: personal trust pack, not a firm compliance report.
   */
  auditIntegrityExport: { solo: true, firm: true, private_deploy: true },
  /** SBOM / security self-check panel entry (IT packaging). */
  securitySbomPanel: { solo: false, firm: false, private_deploy: true },
  /** Quality dashboard JSON export. */
  qualityDashboardJsonExport: { solo: true, firm: true, private_deploy: true },
  /** Workspace-side custom DeliverableSpec (`lawmind/deliverables/*.json`). */
  customDeliverableSpec: { solo: true, firm: true, private_deploy: true },
  /** Acceptance pack export (`acceptance-pack.md`). */
  acceptancePackExport: { solo: true, firm: true, private_deploy: true },
  /**
   * Dangerous tools always need explicit `__approved: true` (no dev bypass).
   * Firm / private default on; Solo keeps lower friction unless policy opts in.
   */
  strictDangerousToolApproval: { solo: false, firm: true, private_deploy: true },
  /** Review campaign `executionMode=parallel` heuristics. */
  reviewCampaignParallel: { solo: true, firm: true, private_deploy: true },
  /**
   * Force peer review before sign-off (needs colleagues).
   * Solo off; Firm / Private on. Overridable via routing/defaults.json.
   */
  forcePeerReview: { solo: false, firm: true, private_deploy: true },
  /**
   * Matter replica collab (invite colleagues, checkout Word, shared relay).
   * On for every edition: two individual lawyers can share one matter without a firm purchase.
   * `policy.matterReplica.enabled: false` still turns it off.
   */
  matterReplicaCollab: { solo: true, firm: true, private_deploy: true },
  /**
   * Ethics wall: hold outbound until lawyer discloses conflicts.
   * Solo off (string-scan hint only); Firm / Private on.
   */
  ethicsWall: { solo: false, firm: true, private_deploy: true },
  /**
   * Word add-in "审这份" auto-run on the desktop.
   * Solo on; Firm / Private off (explicit desktop action). Policy `wordAddinAutoRun` overrides.
   */
  wordAddinAutoRun: { solo: true, firm: false, private_deploy: false },
  /**
   * Tracked redline: independent guardian must pass before export.
   * Solo off (= advisory); Firm / Private on (= block). Policy `guardianTrackedRedline` overrides.
   */
  guardianTrackedRedlineBlock: { solo: false, firm: true, private_deploy: true },
  /**
   * Multi-assistant roster in settings sidebar / day-1 packaging.
   * Solo off: one parent agent; deep-link to 助手编制 still works for power users.
   * Firm / Private on: org staffing. See docs/LAWMIND-SINGLE-PARENT-AGENT.md.
   */
  multiAssistantRoster: { solo: false, firm: true, private_deploy: true },
} as const satisfies Record<string, Record<LawMindEdition, boolean>>;

export type EditionFeatureKey = keyof typeof EDITION_FEATURES;

/** Snapshot of solo defaults — fail-open UI / tests must match this table. */
export function soloEditionFeatures(): Readonly<Record<EditionFeatureKey, boolean>> {
  return featuresForEdition("solo");
}

export function featuresForEdition(
  edition: LawMindEdition,
): Readonly<Record<EditionFeatureKey, boolean>> {
  const features = Object.fromEntries(
    (Object.keys(EDITION_FEATURES) as EditionFeatureKey[]).map((key) => [
      key,
      EDITION_FEATURES[key][edition],
    ]),
  ) as Record<EditionFeatureKey, boolean>;
  return Object.freeze(features);
}

/** Normalize edition strings (`Firm` / `FIRM` → `firm`). Invalid → undefined. */
export function normalizeEdition(value: unknown): LawMindEdition | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const raw = value.trim().toLowerCase();
  return (EDITION_VALUES as readonly string[]).includes(raw) ? (raw as LawMindEdition) : undefined;
}
