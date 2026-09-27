/**
 * useEdition — fetch the resolved LawMind product edition + feature flags.
 *
 * Single, cached hook so any component can do:
 *   const { edition, label, features } = useEdition(apiBase);
 *   if (features.acceptanceGateStrict) { ... }
 *
 * Fail-open: on network error returns Solo defaults from the shared edition table
 * so the UI never breaks and does not hide Solo-on capabilities.
 *
 * Types/defaults come from browser-safe `edition-features.ts` (no node: imports).
 */

import { useEffect, useState } from "react";
import {
  EDITION_LABELS,
  soloEditionFeatures,
  type EditionFeatureKey,
  type LawMindEdition,
} from "../../../../src/lawmind/policy/edition-features.js";
import { apiGetJson } from "./api-client";

export type { LawMindEdition, EditionFeatureKey };

export type EditionFeatures = Record<EditionFeatureKey, boolean>;

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
  label: EDITION_LABELS.solo,
  source: "default",
  features: { ...soloEditionFeatures() },
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
          features: { ...soloEditionFeatures(), ...j.features },
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
