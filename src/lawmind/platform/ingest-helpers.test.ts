import { describe, expect, it } from "vitest";
import {
  ingestFailure,
  ingestSuccess,
  toolDataFromIngestSuccess,
  toolFailureFromIngest,
} from "./ingest-helpers.js";

describe("platform/ingest-helpers", () => {
  it("builds ingestFailure with optional hint", () => {
    expect(ingestFailure("INGEST_NOT_FOUND", "file_stat", "missing", "check path")).toEqual({
      ok: false,
      code: "INGEST_NOT_FOUND",
      stage: "file_stat",
      message: "missing",
      hint: "check path",
    });
  });

  it("builds ingestSuccess", () => {
    expect(ingestSuccess("pdf", "hello", false, 42, "pdf_text")).toEqual({
      ok: true,
      sourceType: "pdf",
      content: "hello",
      truncated: false,
      bytes: 42,
      stage: "pdf_text",
    });
  });

  it("maps failure to tool result", () => {
    const failure = ingestFailure("INGEST_INVALID_PATH", "path_validation", "bad");
    expect(toolFailureFromIngest(failure)).toEqual({
      ok: false,
      error: "bad",
      data: { errorCode: "INGEST_INVALID_PATH", ingestStage: "path_validation", hint: undefined },
    });
  });

  it("maps success to tool data with extras", () => {
    const success = ingestSuccess("docx", "body", true, 100, "office_extract");
    expect(toolDataFromIngestSuccess(success, { path: "a.docx" })).toEqual({
      ok: true,
      data: {
        path: "a.docx",
        content: "body",
        truncated: true,
        sourceType: "docx",
        ingestStage: "office_extract",
        bytes: 100,
      },
    });
  });
});
