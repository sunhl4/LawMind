/**
 * Server-side intent compile: peek documents + matter kind, then leaf compileIntent.
 * Keeps compileIntent free of fs for the renderer.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import type { LawyerCapabilityId } from "../skills/lawyer-capability-lock.js";
import { compileIntent } from "./compile-intent.js";
import { loadMatterKindForIntent, peekPinnedDocuments } from "./peek-pinned-documents.js";
import type { CompiledIntent, CompileIntentInput } from "./types.js";

export type CompileTurnIntentInput = {
  workspaceDir: string;
  projectDir?: string;
  instruction: string;
  pins?: ComposeContextPin[];
  matterId?: string;
  /** Prefer session lastBound; optional override for preview APIs. */
  previousCapabilityId?: LawyerCapabilityId;
  historyText?: string;
  mailFastPath?: boolean;
  capabilityId?: LawyerCapabilityId;
  deliverableType?: string;
};

export async function compileTurnIntent(input: CompileTurnIntentInput): Promise<CompiledIntent> {
  const documents = await peekPinnedDocuments({
    workspaceDir: input.workspaceDir,
    projectDir: input.projectDir,
    pins: input.pins,
  }).catch(() => []);
  const leaf: CompileIntentInput = {
    instruction: input.instruction,
    pins: input.pins,
    documents,
    matterKind: loadMatterKindForIntent(input.workspaceDir, input.matterId),
    previousCapabilityId: input.previousCapabilityId,
    historyText: input.historyText,
    mailFastPath: input.mailFastPath,
    capabilityId: input.capabilityId,
    deliverableType: input.deliverableType,
  };
  return compileIntent(leaf);
}
