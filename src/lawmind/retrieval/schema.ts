import { z } from "zod";
import type { ModelRetrievalOutput } from "./model-adapters.js";

const claimSchema = z.object({
  text: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const sourceSchema = z.object({
  title: z.string().min(1),
  citation: z.string().optional(),
  url: z.string().optional(),
});

const modelRetrievalOutputSchema = z.object({
  claims: z.array(claimSchema).default([]),
  sources: z.array(sourceSchema).optional(),
  riskFlags: z.array(z.string()).optional(),
  missingItems: z.array(z.string()).optional(),
});

/**
 * Validate and normalize model output.
 * Invalid output does not throw; it returns fallback with risk flags.
 */
export function validateModelRetrievalOutput(raw: unknown): ModelRetrievalOutput {
  const parsed = modelRetrievalOutputSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    claims: [],
    riskFlags: [
      "模型输出未通过结构校验，已降级为空结果。",
      ...parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"} ${i.message}`),
    ],
    missingItems: ["请重试或检查模型输出格式约束。"],
  };
}
