/**
 * Platform ingest helpers — shared IngestResult builders for agent tools.
 * See docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md §1.
 */

import type {
  IngestErrorCode,
  IngestFailure,
  IngestSourceType,
  IngestStage,
  IngestSuccess,
} from "./contracts.js";

export function ingestFailure(
  code: IngestErrorCode,
  stage: IngestStage,
  message: string,
  hint?: string,
): IngestFailure {
  return { ok: false, code, stage, message, hint };
}

export function ingestSuccess(
  sourceType: IngestSourceType,
  content: string,
  truncated: boolean,
  bytes: number,
  stage: IngestStage,
): IngestSuccess {
  return { ok: true, sourceType, content, truncated, bytes, stage };
}

/** Map IngestFailure to agent tool result shape (backward compatible). */
export function toolFailureFromIngest(failure: IngestFailure) {
  return {
    ok: false as const,
    error: failure.message,
    data: {
      errorCode: failure.code,
      ingestStage: failure.stage,
      hint: failure.hint,
    },
  };
}

/** Map IngestSuccess to tool data fields shared by analyze_document / read_project_file. */
export function toolDataFromIngestSuccess(
  result: IngestSuccess,
  extra: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } {
  return {
    ok: true,
    data: {
      ...extra,
      content: result.content,
      truncated: result.truncated,
      sourceType: result.sourceType,
      ingestStage: result.stage,
      bytes: result.bytes,
    },
  };
}
