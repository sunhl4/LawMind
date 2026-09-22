/**
 * Platform ingest helpers — shared IngestResult builders for agent tools.
 * See docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md §1.
 */

import {
  type ContentTrustLevel,
  untrustedDocumentFields,
  wrapUntrustedDocumentContent,
} from "./content-trust.js";
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

export type IngestToolDataOptions = {
  /** When set, wraps `content` with an untrusted-document banner for the model. */
  contentTrust?: ContentTrustLevel;
};

/** Map IngestSuccess to tool data fields shared by analyze_document / read_project_file. */
export function toolDataFromIngestSuccess(
  result: IngestSuccess,
  extra: Record<string, unknown>,
  opts: IngestToolDataOptions = {},
): { ok: true; data: Record<string, unknown> } {
  const trust = opts.contentTrust === "untrusted_user_document" ? untrustedDocumentFields() : {};
  const content =
    opts.contentTrust === "untrusted_user_document"
      ? wrapUntrustedDocumentContent(result.content)
      : result.content;
  return {
    ok: true,
    data: {
      ...extra,
      ...trust,
      content,
      truncated: result.truncated,
      sourceType: result.sourceType,
      ingestStage: result.stage,
      bytes: result.bytes,
    },
  };
}
