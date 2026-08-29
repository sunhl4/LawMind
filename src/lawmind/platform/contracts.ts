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

export type GateDecisionKind =
  | "clarification_gate"
  | "intake_gate"
  | "dangerous_tool_gate"
  | "approval_gate"
  | "acceptance_gate"
  | "reasoning_gate"
  | "redline_hunks_gate"
  /** Contract surgical find/replace must be span-local (short anchor; not whole sentence/paragraph). */
  | "surgical_span_gate"
  /** Draft citations do not match the research bundle source ids. */
  | "citation_integrity_gate"
  /** Outbound text looks privileged; lawyer must confirm before queueing send. */
  | "outbound_privilege_gate"
  /** Recipient domain is outside workspace outboundAllowedDomains. */
  | "outbound_recipient_gate";

export type GateDecision = {
  gate: GateDecisionKind;
  decision: "allow" | "block" | "awaiting_confirmation";
  reason?: string;
  /** safety_hard = empty deliverable / approval / dangerous tools; judgment_soft = advisory coaching */
  category?: GateCategory;
};

/** Alias retained for platform-contracts check / older docs. */
export type ExecutionState = TaskExecutionState;

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
