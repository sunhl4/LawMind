/**
 * Model-based Retrieval Adapters
 *
 * 提供通用模型与法律模型的可插拔适配器工厂。
 * 适配器通过回调注入实际模型调用，不绑定任何厂商 SDK。
 */

import { randomUUID } from "node:crypto";
import type { MemoryContext } from "../memory/index.js";
import type { ResearchClaim, ResearchSource, TaskIntent } from "../types.js";
import type { RetrievalAdapter, RetrievalResult } from "./index.js";
import { validateModelRetrievalOutput } from "./schema.js";

export type ModelRetrievalInput = {
  intent: TaskIntent;
  memory: MemoryContext;
  signal?: AbortSignal;
};

export type ModelRetrievalOutput = {
  claims: Array<{ text: string; confidence: number }>;
  sources?: Array<{ title: string; citation?: string; url?: string }>;
  riskFlags?: string[];
  missingItems?: string[];
};

export type ModelRetriever = (input: ModelRetrievalInput) => Promise<ModelRetrievalOutput>;

type CreateModelAdapterParams = {
  name: string;
  role: "general" | "legal";
  supports: (intent: TaskIntent) => boolean;
  run: ModelRetriever;
};

function toClaims(
  role: "general" | "legal",
  claims: ModelRetrievalOutput["claims"],
  sourceIds: string[],
): ResearchClaim[] {
  return claims
    .filter((c) => c.text.trim().length > 0)
    .map((c) => ({
      text: c.text.trim(),
      sourceIds,
      confidence: Math.max(0, Math.min(1, c.confidence)),
      model: role,
    }));
}

function toSources(
  role: "general" | "legal",
  sources: NonNullable<ModelRetrievalOutput["sources"]>,
): ResearchSource[] {
  return sources.map((s) => ({
    id: randomUUID(),
    title: s.title,
    kind: role === "legal" ? "statute" : "web",
    citation: s.citation,
    url: s.url,
  }));
}

/**
 * 通用模型/法律模型适配器工厂（底层）。
 */
export function createModelAdapter(params: CreateModelAdapterParams): RetrievalAdapter {
  return {
    name: params.name,
    supports: params.supports,
    async retrieve({ intent, memory, signal }): Promise<RetrievalResult> {
      const raw = await params.run({ intent, memory, signal });
      const output = validateModelRetrievalOutput(raw);
      const sources = output.sources ? toSources(params.role, output.sources) : [];
      const sourceIds = sources.map((s) => s.id);
      const claims = toClaims(params.role, output.claims ?? [], sourceIds);
      return {
        sources,
        claims,
        riskFlags: output.riskFlags ?? [],
        missingItems: output.missingItems ?? [],
      };
    },
  };
}

/**
 * 通用模型检索适配器工厂。
 * 默认支持：research.general / research.hybrid / draft.ppt
 */
export function createGeneralModelAdapter(run: ModelRetriever): RetrievalAdapter {
  return createModelAdapter({
    name: "model-general",
    role: "general",
    supports: (intent) =>
      intent.kind === "research.general" ||
      intent.kind === "research.hybrid" ||
      intent.kind === "draft.ppt",
    run,
  });
}

/**
 * 法律模型检索适配器工厂。
 * 默认支持：research.legal / research.hybrid / analyze.contract / draft.word
 */
export function createLegalModelAdapter(run: ModelRetriever): RetrievalAdapter {
  return createModelAdapter({
    name: "model-legal",
    role: "legal",
    supports: (intent) =>
      intent.kind === "research.legal" ||
      intent.kind === "research.hybrid" ||
      intent.kind === "analyze.contract" ||
      intent.kind === "draft.word",
    run,
  });
}
