/**
 * 案卷简报与案卷行热因句：模型只做呈现，ground 在本机 pulse / 本案速览。
 * 失败即降级；缓存按 grounding hash 复用。
 */

import { createHash } from "node:crypto";
import { extractAssistantText } from "../agent/assistant-text.js";
import { buildMatterContextFragmentBody } from "../agent/matter-context-fragment.js";
import { callModelWithRetry } from "../agent/runtime-model-call.js";
import type { AgentModelConfig } from "../agent/types.js";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import { buildMatterPulse } from "./matter-pulse.js";

type BriefCacheEntry = { hash: string; text: string; at: number };
const briefCache = new Map<string, BriefCacheEntry>();
const hotlineCache = new Map<string, BriefCacheEntry>();
const MAX_SIDECAR_CACHE = 80;

function putSidecarCache(
  map: Map<string, BriefCacheEntry>,
  key: string,
  entry: BriefCacheEntry,
): void {
  if (!map.has(key) && map.size >= MAX_SIDECAR_CACHE) {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [k, v] of map) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      map.delete(oldestKey);
    }
  }
  map.set(key, entry);
}

function hashText(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function buildBriefGrounding(workspaceDir: string, matterId: string): string | undefined {
  const pulse = buildMatterPulse(workspaceDir, matterId);
  if (!pulse) {
    return undefined;
  }
  const fragment = buildMatterContextFragmentBody({ workspaceDir, matterId });
  const parts = [`案件：${pulse.title}`];
  if (pulse.statusLabel) {
    parts.push(`状态：${pulse.statusLabel}`);
  }
  if (fragment?.trim()) {
    parts.push(fragment.trim());
  }
  if (pulse.nextActions.length > 0) {
    parts.push(`待办摘录：${pulse.nextActions.slice(0, 4).join("；")}`);
  }
  return parts.join("\n\n");
}

export function matterBriefGroundingHash(
  workspaceDir: string,
  matterId: string,
): string | undefined {
  const grounding = buildBriefGrounding(workspaceDir, matterId);
  if (!grounding?.trim()) {
    return undefined;
  }
  return hashText(grounding);
}

export async function generateMatterBriefParagraph(opts: {
  workspaceDir: string;
  matterId: string;
  model: AgentModelConfig;
  timeoutCapMs?: number;
}): Promise<
  { ok: true; text: string; hash: string; cached: boolean } | { ok: false; reason: string }
> {
  const matterId = opts.matterId.trim();
  const grounding = buildBriefGrounding(opts.workspaceDir, matterId);
  if (!grounding?.trim()) {
    return { ok: false, reason: "empty_grounding" };
  }
  const hash = hashText(grounding);
  const cached = briefCache.get(matterId);
  if (cached?.hash === hash && cached.text.trim()) {
    return { ok: true, text: cached.text, hash, cached: true };
  }

  const sidecar = resolveClassifySidecarLimits({
    contextTokens: opts.model.contextTokens,
    timeoutMs: opts.model.timeoutMs,
  });
  const timeoutMs =
    typeof opts.timeoutCapMs === "number" && opts.timeoutCapMs > 0
      ? Math.min(sidecar.timeoutMs, opts.timeoutCapMs)
      : Math.min(sidecar.timeoutMs, 45_000);

  try {
    const response = await callModelWithRetry(
      {
        ...opts.model,
        maxTokens: Math.min(sidecar.maxTokens, 320),
        timeoutMs,
        temperature: sidecar.temperature,
        maxRetries: 0,
      },
      [
        {
          role: "system",
          content:
            "你是 LawMind 案卷简报助手。根据提供的本案结构化摘录，用 2–3 句中文说明「这案现在到哪了」。只写摘录里出现的事实；不要编造；不要 JSON；不要标题。",
        },
        { role: "user", content: grounding.slice(0, 12_000) },
      ],
      [],
    );
    const text = extractAssistantText(response).text.replace(/\s+/g, " ").trim();
    if (text.length < 12) {
      return { ok: false, reason: "empty_model" };
    }
    putSidecarCache(briefCache, matterId, { hash, text, at: Date.now() });
    return { ok: true, text, hash, cached: false };
  } catch {
    return { ok: false, reason: "model_failed" };
  }
}

export async function generateMatterHotlines(opts: {
  workspaceDir: string;
  rows: Array<{ matterId: string; title: string; hot: string }>;
  model: AgentModelConfig;
  timeoutCapMs?: number;
}): Promise<
  { ok: true; lines: Record<string, string>; cached: boolean } | { ok: false; reason: string }
> {
  const rows = opts.rows.filter((r) => r.matterId.trim() && r.hot.trim()).slice(0, 20);
  if (rows.length === 0) {
    return { ok: false, reason: "empty_rows" };
  }

  const groundingParts: string[] = [];
  for (const row of rows) {
    const pulse = buildMatterPulse(opts.workspaceDir, row.matterId);
    const docHint = pulse?.documents?.[0]?.title?.trim()
      ? `最近文书：${pulse.documents[0].title}`
      : "";
    groundingParts.push(
      [`[${row.matterId}] ${row.title}`, `规则热因：${row.hot}`, docHint]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const grounding = groundingParts.join("\n\n");
  const hash = hashText(grounding);
  const cacheKey = rows.map((r) => r.matterId).join(",");
  const cached = hotlineCache.get(cacheKey);
  if (cached?.hash === hash && cached.text.trim()) {
    try {
      const lines = JSON.parse(cached.text) as Record<string, string>;
      return { ok: true, lines, cached: true };
    } catch {
      /* regen */
    }
  }

  const sidecar = resolveClassifySidecarLimits({
    contextTokens: opts.model.contextTokens,
    timeoutMs: opts.model.timeoutMs,
  });
  const timeoutMs =
    typeof opts.timeoutCapMs === "number" && opts.timeoutCapMs > 0
      ? Math.min(sidecar.timeoutMs, opts.timeoutCapMs)
      : Math.min(sidecar.timeoutMs, 60_000);

  const idList = rows.map((r) => r.matterId).join(", ");
  try {
    const response = await callModelWithRetry(
      {
        ...opts.model,
        maxTokens: Math.min(sidecar.maxTokens, 600),
        timeoutMs,
        temperature: sidecar.temperature,
        maxRetries: 0,
      },
      [
        {
          role: "system",
          content: `你是 LawMind 案卷热因助手。根据每条案的规则热因与摘录，为每个 matterId 写一句更具体的中文说明（可串联开庭、文书、待发出等）。只输出 JSON 对象：键为 matterId，值为一句中文。matterId 列表：${idList}`,
        },
        { role: "user", content: grounding.slice(0, 14_000) },
      ],
      [],
    );
    const raw = extractAssistantText(response).text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, reason: "bad_json" };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const lines: Record<string, string> = {};
    for (const row of rows) {
      const v = parsed[row.matterId];
      if (typeof v === "string" && v.trim()) {
        lines[row.matterId] = v.trim();
      }
    }
    if (Object.keys(lines).length === 0) {
      return { ok: false, reason: "empty_model" };
    }
    putSidecarCache(hotlineCache, cacheKey, { hash, text: JSON.stringify(lines), at: Date.now() });
    return { ok: true, lines, cached: false };
  } catch {
    return { ok: false, reason: "model_failed" };
  }
}
