import type { TriageSession } from "../../../../src/lawmind/triage/types.ts";

export async function apiPostTriagePreview(
  apiBase: string,
  body: {
    text: string;
    matterId?: string | null;
    deliverableTypeHint?: string;
    skipGreenConfirm?: boolean;
    dispatchPrompt?: string;
  },
): Promise<{ ok: boolean; session?: TriageSession; autoConfirmed?: boolean; error?: string }> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    session?: TriageSession;
    autoConfirmed?: boolean;
    error?: string;
  };
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    session?: TriageSession;
    error?: string;
    key?: string;
  };
}
