/**
 * useEdition — fetch the resolved LawMind product edition + feature flags.
 *
 * Single, cached hook so any component can do:
 *   const { edition, label, features } = useEdition(apiBase);
 *   if (features.acceptanceGateStrict) { ... }
 *
 * Fails open: on network error returns the `solo` defaults so the UI never breaks.
 */

import { useEffect, useState } from "react";
import { apiGetJson } from "./api-client";

export type LawMindEdition = "solo" | "firm" | "private_deploy";

export type EditionFeatures = {
  acceptanceGateStrict: boolean;
  citationGateStrict: boolean;
  crossMatterRoadmap: boolean;
  crossMatterAcceptanceDashboard: boolean;
  collaborationSummary: boolean;
  complianceAuditExport: boolean;
  auditIntegrityExport: boolean;
  securitySbomPanel: boolean;
  qualityDashboardJsonExport: boolean;
  customDeliverableSpec: boolean;
  acceptancePackExport: boolean;
  strictDangerousToolApproval: boolean;
  reviewCampaignParallel: boolean;
};

export type CitationMode = "grounded" | "assisted" | "off";

export type EditionInfo = {
  edition: LawMindEdition;
  label: string;
  source: "policy_file" | "env" | "default";
  features: EditionFeatures;
  /** Skills E4 — from GET /api/policy/edition */
  citationMode: CitationMode;
  loading: boolean;
};

const SOLO_DEFAULT: EditionInfo = {
  edition: "solo",
  label: "独立律师版",
  source: "default",
  features: {
    acceptanceGateStrict: true,
    citationGateStrict: true,
    crossMatterRoadmap: false,
    crossMatterAcceptanceDashboard: false,
    collaborationSummary: false,
    complianceAuditExport: false,
    auditIntegrityExport: false,
    securitySbomPanel: false,
    qualityDashboardJsonExport: false,
    customDeliverableSpec: false,
    acceptancePackExport: false,
    strictDangerousToolApproval: false,
    reviewCampaignParallel: false,
  },
  citationMode: "assisted",
  loading: true,
};

export function useEdition(apiBase: string): EditionInfo {
  const [info, setInfo] = useState<EditionInfo>(SOLO_DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          edition?: LawMindEdition;
          label?: string;
          source?: EditionInfo["source"];
          features?: Partial<EditionFeatures>;
          citationMode?: CitationMode;
        }>(apiBase, "/api/policy/edition");
        if (cancelled || !j.ok || !j.edition) {
          if (!cancelled) {
            setInfo({ ...SOLO_DEFAULT, loading: false });
          }
          return;
        }
        const citationMode =
          j.citationMode === "grounded" || j.citationMode === "assisted" || j.citationMode === "off"
            ? j.citationMode
            : SOLO_DEFAULT.citationMode;
        setInfo({
          edition: j.edition,
          label: j.label ?? j.edition,
          source: j.source ?? "default",
          features: { ...SOLO_DEFAULT.features, ...j.features },
          citationMode,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setInfo({ ...SOLO_DEFAULT, loading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return info;
}
