export type IngestSourceType =
  | "text"
  | "docx"
  | "xlsx"
  | "pdf"
  | "pdf_ocr"
  | "pdf_vision"
  | "image_ocr"
  | "image_vision";

export type IngestStage =
  | "path_validation"
  | "file_stat"
  | "office_extract"
  | "pdf_text"
  | "pdf_ocr"
  | "pdf_vision"
  | "image_ocr"
  | "image_vision"
  | "text_read";

export type IngestErrorCode =
  | "INGEST_INVALID_PATH"
  | "INGEST_NOT_FOUND"
  | "INGEST_UNSUPPORTED_FORMAT"
  | "INGEST_FILE_TOO_LARGE"
  | "INGEST_BINARY_UNSUPPORTED"
  | "INGEST_PARSE_FAILED"
  | "INGEST_EMPTY_CONTENT";

export type IngestSuccess = {
  ok: true;
  sourceType: IngestSourceType;
  content: string;
  truncated: boolean;
  bytes: number;
  stage: IngestStage;
};

export type IngestFailure = {
  ok: false;
  code: IngestErrorCode;
  stage: IngestStage;
  message: string;
  hint?: string;
};

export type IngestResult = IngestSuccess | IngestFailure;

export type TaskExecutionPhase =
  | "clarify"
  | "plan"
  | "research"
  | "draft"
  | "approval"
  | "render"
  | "complete"
  | "error";

export type TaskExecutionState = {
  phase: TaskExecutionPhase;
  status: "running" | "awaiting_approval" | "awaiting_clarification" | "completed" | "failed";
  linkedTaskId?: string;
  existingTaskId?: string;
  recoverable: boolean;
  detail?: string;
};

export type GateCategory = "safety_hard" | "judgment_soft";

export type GateDecision = {
  gate:
    | "clarification_gate"
    | "intake_gate"
    | "dangerous_tool_gate"
    | "approval_gate"
    | "acceptance_gate"
    | "reasoning_gate"
    | "redline_hunks_gate"
    | "surgical_span_gate"
    | "citation_integrity_gate"
    | "outbound_privilege_gate"
    | "outbound_recipient_gate";
  decision: "allow" | "block" | "awaiting_confirmation";
  reason?: string;
  category?: GateCategory;
};

export type GateDecisionKind = GateDecision["gate"];

export type DeliveryOutcome = {
  taskId: string;
  reviewStatus: "pending" | "approved" | "rejected" | "modified";
  rendered: boolean;
  outputPath?: string;
  acceptanceReady?: boolean;
};

export type AuditEnvelope = {
  eventType: string;
  taskId?: string;
  sessionId?: string;
  sourceType?: IngestSourceType;
  ingestStage?: IngestStage;
  errorCode?: IngestErrorCode;
  durationMs?: number;
  gateDecisions?: GateDecision[];
};
