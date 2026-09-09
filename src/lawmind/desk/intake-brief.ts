/**
 * Intake brief — structured middle layer for talk / materials.
 * Lawyer confirms before facts are treated as case record.
 */

import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import { extractEvidenceChain } from "../reasoning/evidence-chain.js";
import { extractLegalElements } from "../reasoning/legal-elements.js";
import { loadCauseLexicon, suggestCauseCandidates, type CauseCandidate } from "./cause-lexicon.js";

export type IntakeBrief = {
  matterId: string;
  clientNeeds: string[];
  coreFacts: string[];
  issues: string[];
  causeCandidates: CauseCandidate[];
  evidenceGaps: string[];
  nextActions: string[];
  source: "talk" | "materials" | "mixed";
  transcriptExcerpt?: string;
  updatedAt: string;
  confirmedAt?: string;
};

function briefPath(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "matters", matterId, "intake-brief.json");
}

function asStringList(raw: unknown, max = 20): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function parseIntakeBrief(raw: unknown, matterId: string): IntakeBrief | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  return {
    matterId,
    clientNeeds: asStringList(o.clientNeeds),
    coreFacts: asStringList(o.coreFacts),
    issues: asStringList(o.issues),
    causeCandidates: Array.isArray(o.causeCandidates)
      ? o.causeCandidates
          .map((row) => {
            if (!row || typeof row !== "object") {
              return null;
            }
            const r = row as Record<string, unknown>;
            const label = typeof r.label === "string" ? r.label.trim() : "";
            if (!label) {
              return null;
            }
            return {
              label,
              reason: typeof r.reason === "string" ? r.reason.trim() : "",
            };
          })
          .filter((row): row is CauseCandidate => row !== null)
          .slice(0, 8)
      : [],
    evidenceGaps: asStringList(o.evidenceGaps),
    nextActions: asStringList(o.nextActions),
    source: o.source === "materials" || o.source === "mixed" ? o.source : "talk",
    transcriptExcerpt:
      typeof o.transcriptExcerpt === "string"
        ? o.transcriptExcerpt.trim().slice(0, 800)
        : undefined,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    confirmedAt: typeof o.confirmedAt === "string" ? o.confirmedAt : undefined,
  };
}

export function loadIntakeBrief(workspaceDir: string, matterId: string): IntakeBrief | undefined {
  const file = briefPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(file)) {
      return undefined;
    }
    return parseIntakeBrief(JSON.parse(fs.readFileSync(file, "utf8")), matterId) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function saveIntakeBrief(
  workspaceDir: string,
  brief: IntakeBrief,
): Promise<IntakeBrief> {
  const next: IntakeBrief = { ...brief, updatedAt: new Date().toISOString() };
  const file = briefPath(workspaceDir, brief.matterId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeFileAtomicAsync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function confirmIntakeBrief(
  workspaceDir: string,
  matterId: string,
): Promise<IntakeBrief | undefined> {
  const brief = loadIntakeBrief(workspaceDir, matterId);
  if (!brief) {
    return undefined;
  }
  return saveIntakeBrief(workspaceDir, { ...brief, confirmedAt: new Date().toISOString() });
}

function extractNeeds(text: string): string[] {
  const needs: string[] = [];
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (/希望|要求|想要|务必|必须.*(赔|还|付|解除|起诉)/.test(t)) {
      needs.push(t.slice(0, 120));
    }
  }
  if (needs.length === 0 && /起诉|告|要回|赔偿/.test(text)) {
    needs.push("客户希望通过法律途径主张权利或追回款项");
  }
  return [...new Set(needs)].slice(0, 8);
}

export function compileIntakeBrief(input: {
  matterId: string;
  transcript: string;
  workspaceDir: string;
  priorCauses?: string[];
}): IntakeBrief {
  const text = input.transcript.trim();
  const elements = extractLegalElements(text);
  const chain = extractEvidenceChain(text);
  const lexicon = loadCauseLexicon(input.workspaceDir);
  const causeCandidates = suggestCauseCandidates(text, lexicon);
  for (const prior of input.priorCauses ?? []) {
    if (prior.trim() && !causeCandidates.some((c) => c.label === prior.trim())) {
      causeCandidates.push({ label: prior.trim(), reason: "旧案档案中的案由" });
    }
  }
  const facts = [...elements.facts, ...elements.oral.map((o) => `口语：${o}`)]
    .filter(Boolean)
    .slice(0, 12);
  const evidenceGaps = chain.filter((l) => l.weight === "待补").map((l) => l.factToProve);
  const named = chain.filter((l) => l.weight !== "待补").map((l) => l.evidence);
  if (named.length === 0 && evidenceGaps.length === 0) {
    evidenceGaps.push("尚无点名证据，需整理合同/转账/聊天记录等");
  }
  return {
    matterId: input.matterId,
    clientNeeds: extractNeeds(text),
    coreFacts: facts.length > 0 ? facts : [text.slice(0, 200)],
    issues: chain.map((l) => l.claim).slice(0, 8),
    causeCandidates: causeCandidates.slice(0, 5),
    evidenceGaps: evidenceGaps.slice(0, 10),
    nextActions: [
      causeCandidates[0] ? `核对案由是否为「${causeCandidates[0].label}」` : "补充案由候选",
      "整理证据目录（已点名的入卷，未点名标待补）",
      /开庭|传票/.test(text) ? "把开庭或期限写入工作台期限" : "需要起诉时走诉讼文书办件",
    ],
    source: "talk",
    transcriptExcerpt: text.slice(0, 800),
    updatedAt: new Date().toISOString(),
  };
}
