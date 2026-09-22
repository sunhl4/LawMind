import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";
import { runTriageRules } from "./rules.js";
import type { TriagePreviewInput, TriageSession } from "./types.js";

const SAFE_SESSION = /^[a-zA-Z0-9_-]{1,128}$/;

export function triageDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "triage");
}

export function triageSessionPath(
  workspaceDir: string,
  matterId: string,
  sessionId: string,
): string {
  const safe = sessionId.trim();
  if (!SAFE_SESSION.test(safe)) {
    throw new Error(`unsafe triage session id: ${sessionId}`);
  }
  return path.join(triageDir(workspaceDir, matterId), `${safe}.json`);
}

/** Sessions without matter go under workspace/lawmind/triage/ */
export function orphanTriageDir(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "triage");
}

export function orphanTriagePath(workspaceDir: string, sessionId: string): string {
  const safe = sessionId.trim();
  if (!SAFE_SESSION.test(safe)) {
    throw new Error(`unsafe triage session id: ${sessionId}`);
  }
  return path.join(orphanTriageDir(workspaceDir), `${safe}.json`);
}

function resolvePath(workspaceDir: string, matterId: string | null, sessionId: string): string {
  if (matterId) {
    return triageSessionPath(workspaceDir, assertSafeMatterId(matterId), sessionId);
  }
  return orphanTriagePath(workspaceDir, sessionId);
}

export function createTriageSession(
  workspaceDir: string,
  input: TriagePreviewInput,
): TriageSession {
  const result = runTriageRules(input);
  const now = new Date().toISOString();
  const id = `triage_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const session: TriageSession = {
    id,
    matterId: input.matterId?.trim() || null,
    createdAt: now,
    updatedAt: now,
    status: "preview",
    inputSummary: input.text.trim().slice(0, 4000),
    deliverableTypeHint: input.deliverableTypeHint,
    result,
  };
  persistTriageSession(workspaceDir, session);
  return session;
}

export function persistTriageSession(workspaceDir: string, session: TriageSession): void {
  const file = resolvePath(workspaceDir, session.matterId, session.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function readTriageSession(
  workspaceDir: string,
  sessionId: string,
  matterId?: string | null,
): TriageSession | null {
  const candidates: string[] = [];
  if (matterId) {
    candidates.push(resolvePath(workspaceDir, matterId, sessionId));
  }
  candidates.push(orphanTriagePath(workspaceDir, sessionId));
  if (!matterId) {
    /* also scan matter triage dirs is expensive; require matterId for matter-scoped */
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) {
        continue;
      }
      return JSON.parse(fs.readFileSync(file, "utf8")) as TriageSession;
    } catch {
      continue;
    }
  }
  return null;
}

export function confirmTriageSession(
  workspaceDir: string,
  session: TriageSession,
  opts?: { clarificationAnswers?: Record<string, string>; dispatchPrompt?: string },
): TriageSession {
  const answers = opts?.clarificationAnswers ?? {};
  const required = session.result.clarifications.filter((c) => c.required);
  for (const c of required) {
    if (session.result.tier === "red" || session.result.tier === "yellow") {
      const ans = answers[c.key]?.trim();
      if (!ans) {
        throw new Error(`missing_clarification:${c.key}`);
      }
    }
  }
  const clarifications = session.result.clarifications.map((c) => ({
    ...c,
    answer: answers[c.key]?.trim() || c.answer,
  }));
  const updated: TriageSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    status: "confirmed",
    result: { ...session.result, clarifications },
    dispatchPrompt: opts?.dispatchPrompt ?? session.dispatchPrompt,
  };
  persistTriageSession(workspaceDir, updated);
  return updated;
}

export function saveTriageSessionOnly(workspaceDir: string, session: TriageSession): TriageSession {
  const updated: TriageSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    status: "saved_only",
  };
  persistTriageSession(workspaceDir, updated);
  return updated;
}

/** Heavy tools blocked until confirmed when tier is yellow/red. */
export function triageBlocksHeavyExecute(session: TriageSession | null | undefined): boolean {
  if (!session) {
    return false;
  }
  if (session.status === "confirmed") {
    return false;
  }
  return session.result.tier === "yellow" || session.result.tier === "red";
}
