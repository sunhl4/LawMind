/**
 * Skills E10-lite — lawyer-facing preview of dangerous tool args before approve.
 */

export type ToolArgDiffLine = {
  key: string;
  kind: "set" | "nested" | "truncated";
  value: string;
};

const SENSITIVE_KEY = /(?:password|secret|token|api[_-]?key|authorization)/i;
const MAX_LINES = 24;
const MAX_VALUE_LEN = 120;

/** Parameter keys → 律师可读标签（UI 不展示 eng_snake / camelCase） */
const KEY_LABEL_ZH: Record<string, string> = {
  file_path: "保存位置",
  path: "保存位置",
  content: "文书内容",
  task_id: "关联事项",
  taskId: "关联事项",
  workflow_id: "办案流程",
  workflowId: "办案流程",
  title: "标题",
  summary: "摘要",
  sections: "章节结构",
  matter_id: "案件",
  matterId: "案件",
  session_id: "对话",
  sessionId: "对话",
  assistant_id: "协办人",
  assistantId: "协办人",
  role_id: "岗位",
  roleId: "岗位",
  query: "检索词",
  q: "检索词",
  to: "收件人",
  subject: "邮件主题",
  body: "邮件正文",
  note: "备注",
  reason: "事由",
  deadline: "期限",
  due_at: "期限",
  dueAt: "期限",
};

function labelKey(key: string): string {
  if (KEY_LABEL_ZH[key]) {
    return KEY_LABEL_ZH[key];
  }
  // 英文字段名（含 snake / camel）一律不直出，避免程序员变量名进界面
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
    return "相关内容";
  }
  return key;
}

function stringifyValue(value: unknown, key: string): string {
  if (value === null) {
    return "（空）";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "（空）";
    }
    if (key === "content" || key === "body" || trimmed.length > MAX_VALUE_LEN) {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return "拟写入内容（正文从略）";
      }
      if (trimmed.length > MAX_VALUE_LEN) {
        return `${trimmed.slice(0, 48)}…（已从略）`;
      }
    }
    return trimmed.length > MAX_VALUE_LEN ? `${trimmed.slice(0, MAX_VALUE_LEN)}…` : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (key === "sections" || key === "content") {
    return "拟更新内容（明细从略）";
  }
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 80) {
      return "结构化内容（明细从略）";
    }
    return raw;
  } catch {
    return "（无法预览）";
  }
}

/**
 * Flatten tool args into short lawyer-facing lines for approval cards.
 */
export function formatToolArgsDiffPreview(
  toolArgs: Record<string, unknown> | null | undefined,
): ToolArgDiffLine[] {
  if (!toolArgs || typeof toolArgs !== "object") {
    return [];
  }
  const lines: ToolArgDiffLine[] = [];
  for (const [key, value] of Object.entries(toolArgs)) {
    if (key === "__approved") {
      continue;
    }
    if (lines.length >= MAX_LINES) {
      lines.push({ key: "…", kind: "truncated", value: "其余内容已从略" });
      break;
    }
    const label = labelKey(key);
    if (SENSITIVE_KEY.test(key)) {
      lines.push({ key: label, kind: "set", value: "（已隐藏）" });
      continue;
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      lines.push({ key: label, kind: "nested", value: stringifyValue(value, key) });
      continue;
    }
    lines.push({ key: label, kind: "set", value: stringifyValue(value, key) });
  }
  return lines;
}

export function toolArgsDiffPreviewText(
  toolArgs: Record<string, unknown> | null | undefined,
): string {
  return formatToolArgsDiffPreview(toolArgs)
    .map((l) => (l.kind === "truncated" ? l.value : `${l.key}：${l.value}`))
    .join("\n");
}

export type ApprovalDocumentPreview = {
  /** 文书标题（律师可读） */
  title: string;
  /** 完整正文，供审批阅读 */
  body: string;
  /** 次要说明（不含路径/扩展名） */
  meta: string[];
};

const DOC_WRITE_SKIP_KEYS = new Set(["__approved", "content", "body"]);

/** 系统/关联 id 与保存路径：律师签批时几乎不手改，不算「值得开弹窗」的短参数。 */
const LAWYER_SHORT_EDIT_SKIP_KEYS = new Set([
  ...DOC_WRITE_SKIP_KEYS,
  "file_path",
  "path",
  "task_id",
  "taskId",
  "matter_id",
  "matterId",
  "session_id",
  "sessionId",
  "assistant_id",
  "assistantId",
  "role_id",
  "roleId",
]);

/**
 * 拟写入整篇文书（`content`）— 与「文书台」改稿重合，在办不应再开全文编辑。
 * 邮件等仅有 `body` 的短字段批准不在此列。
 */
export function toolArgsAreDocumentWrite(
  toolArgs: Record<string, unknown> | null | undefined,
): boolean {
  if (!toolArgs || typeof toolArgs !== "object") {
    return false;
  }
  const content = toolArgs.content;
  if (typeof content !== "string" || !content.trim()) {
    return false;
  }
  // Require a save path so case notes / progress rows with `content` stay editable.
  const filePath =
    (typeof toolArgs.file_path === "string" && toolArgs.file_path.trim()) ||
    (typeof toolArgs.path === "string" && toolArgs.path.trim());
  return Boolean(filePath);
}

/** 文书写入场景下仍可在弹窗改的短字段（保存位置、标题等），不含正文。 */
export function toolArgsHaveShortEditFields(
  toolArgs: Record<string, unknown> | null | undefined,
): boolean {
  if (!toolArgs || typeof toolArgs !== "object") {
    return false;
  }
  if (typeof toolArgs.file_path === "string" || typeof toolArgs.path === "string") {
    return true;
  }
  for (const [key, value] of Object.entries(toolArgs)) {
    if (DOC_WRITE_SKIP_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return true;
    }
  }
  return false;
}

/**
 * 律师值得打开「改参数/改拟稿」弹窗的短文字字段（标题、摘要、收件人等）。
 * 不含正文、保存路径与各类 id——路径级调整应走驳回/对话，避免为单一 path 开大窗。
 */
export function toolArgsHaveLawyerEditableShortFields(
  toolArgs: Record<string, unknown> | null | undefined,
): boolean {
  if (!toolArgs || typeof toolArgs !== "object") {
    return false;
  }
  for (const [key, value] of Object.entries(toolArgs)) {
    if (LAWYER_SHORT_EDIT_SKIP_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      return true;
    }
  }
  return false;
}

/** 从工具参数取出关联草稿 taskId（若有）。 */
export function toolArgsLinkedTaskId(
  toolArgs: Record<string, unknown> | null | undefined,
): string | null {
  if (!toolArgs || typeof toolArgs !== "object") {
    return null;
  }
  for (const key of ["taskId", "task_id"] as const) {
    const v = toolArgs[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return null;
}

function basenameLabel(pathLike: string): string {
  const base = pathLike
    .replace(/^.*[/\\]/, "")
    .replace(/\.(md|json|docx|txt)$/i, "")
    .trim();
  return base;
}

/**
 * 从待批准工具参数提取可整页阅读的文书正文（审批用大阅读面）。
 */
export function extractApprovalDocumentPreview(
  toolArgs: Record<string, unknown> | null | undefined,
): ApprovalDocumentPreview | null {
  if (!toolArgs || typeof toolArgs !== "object") {
    return null;
  }
  const raw =
    typeof toolArgs.content === "string"
      ? toolArgs.content
      : typeof toolArgs.body === "string"
        ? toolArgs.body
        : "";
  if (!raw.trim()) {
    return null;
  }

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  let bodyStart = 0;
  const first = lines[0]?.trim() ?? "";
  if (first.startsWith("# ")) {
    title = first.slice(2).trim();
    bodyStart = 1;
    while (bodyStart < lines.length && !lines[bodyStart].trim()) {
      bodyStart += 1;
    }
  }

  const pathRaw =
    typeof toolArgs.file_path === "string"
      ? toolArgs.file_path
      : typeof toolArgs.path === "string"
        ? toolArgs.path
        : "";
  const fromPath = pathRaw ? basenameLabel(pathRaw) : "";
  if (!title && fromPath) {
    title = fromPath;
  }
  if (!title && typeof toolArgs.title === "string" && toolArgs.title.trim()) {
    title = toolArgs.title.trim();
  }
  if (!title) {
    title = "拟写入文书";
  }

  const meta: string[] = [];
  // 从正文引用块抽密级/案件等，不展示路径
  for (const line of lines.slice(0, 12)) {
    const m = line.match(/^>\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)\s*$/);
    if (m?.[1] && m[2]) {
      const k = m[1].trim();
      const v = m[2].trim();
      if (/密级|案件|事项|当事人/.test(k)) {
        meta.push(`${k}：${v}`);
      }
    }
  }

  return {
    title,
    body: raw.trim(),
    meta: meta.slice(0, 4),
  };
}
