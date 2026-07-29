import type { TriageSession } from "../../../../src/lawmind/triage/types.ts";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";

export type TriageMatchedSkill = { id: string; name: string; version?: string };

export async function apiPostTriagePreview(
  apiBase: string,
  body: {
    text: string;
    matterId?: string | null;
    deliverableTypeHint?: string;
    skipGreenConfirm?: boolean;
    dispatchPrompt?: string;
  },
): Promise<{
  ok: boolean;
  session?: TriageSession;
  autoConfirmed?: boolean;
  matchedSkills?: TriageMatchedSkill[];
  error?: string;
}> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    session?: TriageSession;
    autoConfirmed?: boolean;
    matchedSkills?: TriageMatchedSkill[];
    error?: string;
  };
}

export async function apiGetTriageRules(
  apiBase: string,
): Promise<{ ok: boolean; ruleIds?: string[]; error?: string }> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/triage/rules`, {
    headers: { Accept: "application/json", ...apiAuthHeaders() },
  });
  return (await res.json()) as { ok: boolean; ruleIds?: string[]; error?: string };
}

export async function apiPostTriageConfirm(
  apiBase: string,
  body: {
    sessionId: string;
    matterId?: string | null;
    clarificationAnswers?: Record<string, string>;
    dispatchPrompt?: string;
    saveOnly?: boolean;
  },
): Promise<{ ok: boolean; session?: TriageSession; error?: string; key?: string }> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/triage/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    session?: TriageSession;
    error?: string;
    key?: string;
  };
}
