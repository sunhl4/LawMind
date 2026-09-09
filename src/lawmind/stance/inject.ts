/**
 * Ranked Chinese stance lines for the agent system prompt.
 * 注入门槛：证据账本须覆盖 ≥2 个不同案件（当前案件召回自身证据除外）；
 * 注入前按证据来源案件的客户/对方当事人做冲突检查，命中则不注入并记录原因。
 */

import fs from "node:fs";
import path from "node:path";
import { parseMatterCaseProfileFields } from "../cases/matter-profile.js";
import { readStanceItems } from "./store.js";
import type { StanceItem } from "./types.js";

const MIN_HINT_CONFIDENCE = 0.4;
/** 证据账本须覆盖的不同案件数下限（跨案件/全局注入）。 */
const MIN_DISTINCT_EVIDENCE_MATTERS = 2;

function decayedConfidence(confidence: number, updatedAt: string, nowMs = Date.now()): number {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) {
    return confidence;
  }
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  if (ageDays < 30) {
    return confidence;
  }
  const decay = Math.max(0.5, 1 - ageDays / 365);
  return confidence * decay;
}

export type StanceInjectionContext = {
  /** 当前案件：提供时启用冲突检查与同案召回豁免。 */
  matterId?: string;
};

export type StanceInjectionSkip = {
  id: string;
  clauseType: string;
  reason: string;
};

type MatterParties = { clientId?: string; counterparty?: string };

function readMatterParties(workspaceDir: string, matterId: string): MatterParties {
  try {
    const raw = fs.readFileSync(path.join(workspaceDir, "cases", matterId, "CASE.md"), "utf8");
    const parsed = parseMatterCaseProfileFields(raw);
    return {
      clientId: parsed.clientIdFromCase?.trim() || undefined,
      counterparty: parsed.counterparty?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

function distinctEvidenceMatters(item: StanceItem): number {
  const set = new Set<string>();
  for (const e of item.evidence ?? []) {
    if (e.matterId) {
      set.add(e.matterId);
    }
  }
  return set.size;
}

/**
 * 冲突/污染检查（按现有数据可判断的粒度：数据缺失则不臆断）。
 * 返回跳过原因；undefined 表示可注入。
 */
function conflictSkipReason(
  item: StanceItem,
  current: MatterParties | undefined,
  partiesByMatter: Map<string, MatterParties>,
): string | undefined {
  const sources = (item.evidence ?? [])
    .map((e) => (e.matterId ? partiesByMatter.get(e.matterId) : undefined))
    .filter((p): p is MatterParties => Boolean(p));
  const knownClients = new Set(
    sources.map((p) => p.clientId).filter((v): v is string => Boolean(v)),
  );
  const knownCounterparties = new Set(
    sources.map((p) => p.counterparty).filter((v): v is string => Boolean(v)),
  );
  if (current) {
    if (current.clientId && knownCounterparties.has(current.clientId)) {
      return "client_conflict: 当前客户曾是证据来源案件的对方当事人";
    }
    if (current.counterparty && knownClients.has(current.counterparty)) {
      return "client_conflict: 当前对方当事人曾是证据来源案件的客户";
    }
    if (knownClients.size === 1 && current.clientId && !knownClients.has(current.clientId)) {
      return "client_specific: 证据全部来自其他客户";
    }
    if (
      knownCounterparties.size === 1 &&
      current.counterparty &&
      !knownCounterparties.has(current.counterparty)
    ) {
      return "opponent_specific: 证据全部来自其他对手案件";
    }
    return undefined;
  }
  // 全局注入（无案件上下文）：证据集中在单一客户时不进全局提示词，防高频客户偏好劫持。
  if (knownClients.size === 1) {
    return "client_specific: 证据全部来自单一客户，不进全局提示词";
  }
  return undefined;
}

export function selectInjectableStances(
  workspaceDir: string,
  opts?: { max?: number; matterId?: string; nowMs?: number },
): { items: StanceItem[]; skipped: StanceInjectionSkip[] } {
  const limit = opts?.max && Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : 8;
  const nowMs = opts?.nowMs ?? Date.now();
  const currentMatterId = opts?.matterId?.trim() || undefined;
  const items = readStanceItems(workspaceDir);

  const partiesByMatter = new Map<string, MatterParties>();
  const wanted = new Set<string>();
  for (const it of items) {
    for (const e of it.evidence ?? []) {
      if (e.matterId) {
        wanted.add(e.matterId);
      }
    }
  }
  if (currentMatterId) {
    wanted.add(currentMatterId);
  }
  for (const mid of wanted) {
    partiesByMatter.set(mid, readMatterParties(workspaceDir, mid));
  }
  const current = currentMatterId ? partiesByMatter.get(currentMatterId) : undefined;

  const skipped: StanceInjectionSkip[] = [];
  const eligible = items.filter((it) => {
    if (it.supersededBy) {
      return false;
    }
    if (decayedConfidence(it.confidence, it.updatedAt, nowMs) < MIN_HINT_CONFIDENCE) {
      return false;
    }
    if (it.evidence?.length) {
      // 同案召回豁免：证据含当前案件时不适用跨案件门槛
      const caseLocal = currentMatterId
        ? it.evidence.some((e) => e.matterId === currentMatterId)
        : false;
      if (!caseLocal) {
        const distinct = distinctEvidenceMatters(it);
        if (distinct < MIN_DISTINCT_EVIDENCE_MATTERS) {
          skipped.push({
            id: it.id,
            clauseType: it.clauseType,
            reason: `single_matter_evidence: 证据仅覆盖 ${distinct} 个不同案件`,
          });
          return false;
        }
      }
      const conflict = conflictSkipReason(it, current, partiesByMatter);
      if (conflict) {
        skipped.push({ id: it.id, clauseType: it.clauseType, reason: conflict });
        return false;
      }
    }
    return true;
  });

  const ranked = eligible
    .toSorted(
      (a, b) =>
        decayedConfidence(b.confidence, b.updatedAt, nowMs) * b.occurrences -
        decayedConfidence(a.confidence, a.updatedAt, nowMs) * a.occurrences,
    )
    .slice(0, limit);
  return { items: ranked, skipped };
}

export function formatStanceHint(
  workspaceDir: string,
  opts?: { max?: number; matterId?: string },
): string {
  const { items } = selectInjectableStances(workspaceDir, opts);
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((it, i) => `${i + 1}. 【${it.clauseType}】${it.preferredLanguage}`);
  return ["已按你确认的条款立场：", ...lines].join("\n");
}
