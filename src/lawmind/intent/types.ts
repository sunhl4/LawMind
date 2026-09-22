/**
 * Intent compiler types. Leaf (no fs) — safe for the desktop renderer.
 *
 * The compiler turns lawyer text + files + case context into a capability bind.
 * Lawyers never pick 办件 on the default path.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import type { LawyerCapabilityId } from "../skills/lawyer-capability-lock.js";
import type { DeliveryIntent } from "./delivery-intent.js";
import type { DocumentGenre } from "./document-genre.js";
import type { TextIntent } from "./text-intent.js";

export type IntentConfidence = "high" | "medium" | "low";

export type IntentSource =
  | "lock"
  | "short_path"
  | "word_revision"
  | "specialized"
  | "joint"
  | "keyword"
  | "continue"
  | "matter"
  | "genre_default"
  | "unbound";

export type IntentEvidence = {
  kind: "text" | "file" | "matter" | "session" | "lock";
  detail: string;
};

export type IntentAlternative = {
  id: LawyerCapabilityId;
  label: string;
  reason: string;
};

export type IntentSoftAsk = {
  question: string;
  options: Array<{ id: LawyerCapabilityId; label: string }>;
};

export type DocumentPeek = {
  relPath: string;
  peekText?: string;
};

export type CompileIntentInput = {
  instruction: string;
  /** Explicit 办件 lock (UI override or pasted marker). */
  capabilityId?: LawyerCapabilityId;
  deliverableType?: string;
  mailFastPath?: boolean;
  pins?: ComposeContextPin[];
  /** Optional body excerpts (server peek). Filename-only still works. */
  documents?: DocumentPeek[];
  matterKind?: "contract" | "litigation" | "general";
  previousCapabilityId?: LawyerCapabilityId;
  historyText?: string;
};

export type CompiledIntent = {
  capabilityId?: LawyerCapabilityId;
  deliverableType?: string;
  pipelineOverride?: "tracked_redline";
  skillIdsOverride?: readonly string[];
  pipelineHintOverride?: string;
  confidence: IntentConfidence;
  source: IntentSource;
  evidence: IntentEvidence[];
  alternatives: IntentAlternative[];
  /** Primary first; extra ids are the follow-on chain (Codex multi-skill). */
  chain: LawyerCapabilityId[];
  softAsk?: IntentSoftAsk;
  /** One lawyer-facing line, e.g. 本轮按合同审查处理. Compiler never asks the lawyer to classify. */
  lawyerSummary: string;
  /** How to hand over the work. Orthogonal to capability bind; defaults never override this. */
  delivery: DeliveryIntent;
};

export type IntentSignals = {
  instruction: string;
  text: TextIntent;
  documents: Array<{ relPath: string; peekText: string; genre: DocumentGenre }>;
  dominantGenre: DocumentGenre;
  hasMaterials: boolean;
  matterKind?: "contract" | "litigation" | "general";
  previousCapabilityId?: LawyerCapabilityId;
};
