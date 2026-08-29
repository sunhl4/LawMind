/**
 * Execute a deep-research plan: run queries through retrieval adapters and
 * optional URL dossier, then synthesize an evidence-backed outline.
 */

import type { MemoryContext } from "../memory/index.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { RetrievalAdapter } from "../retrieval/index.js";
import { retrieve } from "../retrieval/index.js";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { filterBundleByTopicRelevance } from "./claim-relevance.js";
import { buildDeepResearchPlan, type DeepResearchPlan } from "./deep-research-plan.js";
import {
  buildResearchOutline,
  type ResearchOutline,
  type ResearchOutlineSection,
} from "./research-outline.js";
import {
  extractUrlsFromText,
  fetchUrlDossier,
  mergeDossierIntoBundleParts,
} from "./url-dossier.js";

export type ExecuteDeepResearchResult = {
  plan: DeepResearchPlan;
  bundle: ResearchBundle;
  outline: ResearchOutline;
};

function evidenceBullets(bundle: ResearchBundle, limit = 4): string[] {
  if (bundle.claims.length === 0) {
    return ["【待补充：本视角尚无检索结论】"];
  }
  return bundle.claims.slice(0, limit).map((c) => {
    const cites = c.sourceIds.slice(0, 2).join(",");
    return `${c.text.slice(0, 160)}${cites ? ` 〔${cites}〕` : ""}`;
  });
}

function outlineFromEvidence(intent: TaskIntent, bundle: ResearchBundle): ResearchOutline {
  const base = buildResearchOutline(intent, bundle);
  const evidenceThin = bundle.claims.length === 0;
  const byPerspective = new Map<string, string[]>();
  for (const claim of bundle.claims) {
    const key = /数据|隐私|GDPR|个人信息/i.test(claim.text)
      ? "data"
      : /出口|制裁|管制/i.test(claim.text)
        ? "trade"
        : /广告|反垄断|市场/i.test(claim.text)
          ? "market"
          : "general";
    const arr = byPerspective.get(key) ?? [];
    if (arr.length < 4) {
      arr.push(claim.text.slice(0, 140));
    }
    byPerspective.set(key, arr);
  }

  let sections: ResearchOutlineSection[] = base.sections.map((s) => {
    if (s.id === "findings" || s.id === "rules" || s.id === "regime") {
      const bullets = evidenceBullets(bundle, 5);
      return { ...s, bullets };
    }
    if (s.id === "jurisdiction") {
      const hosts = [
        ...new Set(
          bundle.sources
            .map((src) => {
              try {
                return src.url ? new URL(src.url).hostname : "";
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        ),
      ].slice(0, 6);
      return {
        ...s,
        bullets: hosts.length > 0 ? hosts.map((h) => `${h}：核对效力层级与适用边界`) : s.bullets,
      };
    }
    if (s.id === "sources") {
      return {
        ...s,
        bullets:
          bundle.sources.length > 0
            ? bundle.sources.slice(0, 8).map((src) => `[${src.id}] ${src.title}`)
            : s.bullets,
      };
    }
    return s;
  });

  if (evidenceThin) {
    const gap: ResearchOutlineSection = {
      id: "evidence_gap",
      heading: "证据缺口（确认大纲前请先补齐）",
      purpose: "停写正文直到检索可用",
      bullets: [
        "当前无与主题相关的可用来源/结论",
        "请开启联网检索或粘贴权威 URL 后重跑 deep_research",
        "勿用 write_document 旁路撰写正文",
        ...bundle.missingItems.slice(0, 4),
      ],
    };
    // Keep compliance jurisdiction matrix; insert gap after findings or at front for learning.
    const findingsIdx = sections.findIndex((s) => s.id === "findings");
    if (findingsIdx >= 0) {
      sections = [...sections.slice(0, findingsIdx + 1), gap, ...sections.slice(findingsIdx + 1)];
    } else {
      sections = [gap, ...sections];
    }
  }

  return {
    ...base,
    sections,
    notes: [
      ...base.notes,
      evidenceThin
        ? "证据不足：本大纲含「证据缺口」章，请先补检索再确认扩写"
        : `证据驱动大纲：来源 ${bundle.sources.length} · 结论 ${bundle.claims.length}`,
      ...[...byPerspective.entries()].map(([k, v]) => `${k}: ${v.length} 条要点`),
    ],
  };
}

/**
 * Run planner queries via adapters (breadth-limited), merge any explicit URLs,
 * and produce an evidence-backed outline (still pending until lawyer approves).
 */
export async function executeDeepResearchPlan(opts: {
  intent: TaskIntent;
  memory: MemoryContext;
  adapters: RetrievalAdapter[];
  workspacePolicy?: LawMindWorkspacePolicy | null;
  /** When false, skip outbound URL dossier fetch (adapters-only / offline). Default true. */
  allowWebSearch?: boolean;
  signal?: AbortSignal;
  breadth?: number;
  depth?: number;
}): Promise<ExecuteDeepResearchResult> {
  const plan = buildDeepResearchPlan(opts.intent, {
    breadth: opts.breadth,
    depth: opts.depth,
  });

  const allowWeb = opts.allowWebSearch === true;
  const adapters = allowWeb ? opts.adapters : opts.adapters.filter((a) => a.name !== "url-dossier");

  // Primary retrieve for the original intent (workspace + authority + optional url adapter)
  let bundle = await retrieve({
    intent: opts.intent,
    memory: opts.memory,
    adapters,
    signal: opts.signal,
  });

  // Fan-out: shallow retrieve for top plan queries (cap concurrency cost)
  const querySlice = plan.queries.filter((q) => q.depth === 1).slice(0, plan.breadth);
  for (const q of querySlice) {
    const subIntent: TaskIntent = {
      ...opts.intent,
      summary: q.query,
      instruction: `${opts.intent.instruction}\n\n子问题：${q.query}`,
    };
    const sub = await retrieve({
      intent: subIntent,
      memory: opts.memory,
      adapters,
      signal: opts.signal,
    });
    const merged = mergeDossierIntoBundleParts(
      { sources: bundle.sources, claims: bundle.claims },
      {
        entries: [],
        sources: sub.sources,
        claims: sub.claims,
        okCount: sub.sources.length,
        blockedCount: 0,
        errorCount: 0,
      },
    );
    bundle = {
      ...bundle,
      sources: merged.sources,
      claims: merged.claims,
      riskFlags: [...new Set([...bundle.riskFlags, ...sub.riskFlags])],
      missingItems: [...new Set([...bundle.missingItems, ...sub.missingItems])],
      requiresReview: bundle.requiresReview || sub.requiresReview,
    };
  }

  // Extra URL pass only when web fetch is explicitly allowed.
  const urls = allowWeb ? extractUrlsFromText(opts.intent.instruction) : [];
  if (urls.length > 0 && !bundle.sources.some((s) => s.provider === "url-dossier")) {
    const dossier = await fetchUrlDossier({
      urls,
      workspacePolicy: opts.workspacePolicy,
      maxUrls: 8,
      modelLabel: "deep-research-url",
      signal: opts.signal,
    });
    const merged = mergeDossierIntoBundleParts(bundle, dossier);
    bundle = {
      ...bundle,
      sources: merged.sources,
      claims: merged.claims,
      riskFlags: [
        ...bundle.riskFlags,
        ...(dossier.okCount > 0 ? [`深度研究并入 URL ${dossier.okCount} 条`] : []),
      ],
    };
  } else if (!allowWeb && extractUrlsFromText(opts.intent.instruction).length > 0) {
    bundle = {
      ...bundle,
      riskFlags: [
        ...bundle.riskFlags,
        "深度研究：allowWebSearch 未开启，已跳过 URL 抓取（仅用本地/权威适配器）",
      ],
      missingItems: [...new Set([...bundle.missingItems, "开启联网检索后可抓取指令中的 URL"])],
    };
  }

  const filtered = filterBundleByTopicRelevance(opts.intent, bundle);
  bundle = filtered.bundle;
  const outline = outlineFromEvidence(opts.intent, bundle);
  return { plan, bundle, outline };
}
