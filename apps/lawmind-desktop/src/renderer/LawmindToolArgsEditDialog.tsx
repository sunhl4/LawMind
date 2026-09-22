import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  toolArgsAreDocumentWrite,
  toolArgsLinkedTaskId,
} from "../../../../src/lawmind/platform/tool-approval-diff.ts";

const BODY_KEYS = ["content", "body"] as const;
const PATH_KEYS = ["file_path", "path"] as const;
const SKIP_KEYS = new Set(["__approved", ...BODY_KEYS, ...PATH_KEYS]);

const FIELD_LABEL: Record<string, string> = {
  title: "标题",
  summary: "摘要",
  subject: "邮件主题",
  to: "收件人",
  note: "备注",
  reason: "事由",
  query: "检索词",
  workflowId: "办案流程",
  workflow_id: "办案流程",
  taskId: "关联事项",
  task_id: "关联事项",
};

function pickString(args: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string") {
      return v;
    }
  }
  return "";
}

function bodyKeyOf(args: Record<string, unknown>): "content" | "body" | null {
  if (typeof args.content === "string") {
    return "content";
  }
  if (typeof args.body === "string") {
    return "body";
  }
  return null;
}

function pathKeyOf(args: Record<string, unknown>): "file_path" | "path" | null {
  if (typeof args.file_path === "string") {
    return "file_path";
  }
  if (typeof args.path === "string") {
    return "path";
  }
  return null;
}

function basenameLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export type LawmindToolArgsEditDialogProps = {
  open: boolean;
  toolArgs: Record<string, unknown> | null | undefined;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApprove: (editedArgs: Record<string, unknown>) => void;
  /** 文书写入：有关联草稿时引导打开文书台 */
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  matterId?: string;
};

/**
 * 批准前改短参数。整篇 `content` 文书不在此编辑（与文书台重合）——仅改标题等短字段。
 * 尺寸随模式变化：短字段用紧凑窗；邮件等全文用高窗。
 */
export function LawmindToolArgsEditDialog(props: LawmindToolArgsEditDialogProps): ReactNode {
  const {
    open,
    toolArgs,
    busy = false,
    error = null,
    onCancel,
    onApprove,
    onOpenReview,
    matterId,
  } = props;
  const titleId = useId();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const baseArgs = useMemo(
    () => (toolArgs && typeof toolArgs === "object" ? { ...toolArgs } : {}),
    [toolArgs],
  );
  const documentWrite = toolArgsAreDocumentWrite(baseArgs);
  const bodyKey = bodyKeyOf(baseArgs);
  const pathKey = pathKeyOf(baseArgs);
  /** 仅非文书写入时编辑 body/content 全文（如邮件正文）。 */
  const editFullBody = !documentWrite && bodyKey != null;
  const linkedTaskId = toolArgsLinkedTaskId(baseArgs);
  const sizeMode = editFullBody ? "body" : "compact";

  const [bodyText, setBodyText] = useState("");
  const [pathText, setPathText] = useState("");
  const [extraFields, setExtraFields] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setBodyText(pickString(baseArgs, BODY_KEYS));
    setPathText(pickString(baseArgs, PATH_KEYS));
    const extras: Record<string, string> = {};
    for (const [key, value] of Object.entries(baseArgs)) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }
      if (typeof value === "string") {
        extras[key] = value;
      }
    }
    setExtraFields(extras);
    setLocalError(null);
  }, [open, baseArgs]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      if (editFullBody) {
        bodyRef.current?.focus();
      }
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, busy, onCancel, editFullBody]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const displayError = localError ?? error;
  const pathLabel = pathText ? basenameLabel(pathText) : "";
  const extraEntries = Object.entries(extraFields);

  const submit = () => {
    if (editFullBody && !bodyText.trim()) {
      setLocalError("正文不能为空。");
      return;
    }
    const next: Record<string, unknown> = { ...baseArgs };
    if (editFullBody && bodyKey) {
      next[bodyKey] = bodyText;
    }
    // 文书写入：正文保持原样；路径仅在非文书短字段场景随表单提交（文书写入默认不改路径）
    if (pathKey && !documentWrite) {
      next[pathKey] = pathText.trim();
    }
    for (const [key, value] of Object.entries(extraFields)) {
      next[key] = value;
    }
    setLocalError(null);
    onApprove(next);
  };

  // Portal 到 body：消息行带 contentVisibility:auto，行内 fixed 弹层会被裁剪在行盒内。
  return createPortal(
    <div
      className="lm-wizard-backdrop lm-tool-args-edit-backdrop"
      role="presentation"
      data-testid="lm-tool-args-edit-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        className={`lm-wizard lm-tool-args-edit-dialog lm-tool-args-edit-dialog--${sizeMode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="lm-tool-args-edit-dialog"
        data-document-write={documentWrite ? "true" : undefined}
        data-size={sizeMode}
      >
        <header className="lm-tool-args-edit-head">
          <div>
            <h2 id={titleId}>{documentWrite ? "改参数" : "改拟稿"}</h2>
            <p className="lm-meta lm-tool-args-edit-lead">
              {documentWrite
                ? "短字段；全文请改稿"
                : editFullBody
                  ? "调整后批准"
                  : "调整短字段后批准"}
            </p>
          </div>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={onCancel}
            aria-label="关闭"
          >
            关闭
          </button>
        </header>

        {documentWrite ? (
          <div className="lm-tool-args-edit-doc" data-testid="lm-tool-args-edit-doc-redirect">
            {onOpenReview && linkedTaskId ? (
              <div className="lm-callout lm-callout-muted" role="note">
                <p className="lm-callout-title">全文请到改稿页编辑</p>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  disabled={busy}
                  data-testid="lm-tool-args-open-review"
                  onClick={() => {
                    onCancel();
                    onOpenReview(linkedTaskId, matterId);
                  }}
                >
                  打开改稿
                </button>
              </div>
            ) : null}
            {pathLabel ? (
              <p className="lm-meta lm-tool-args-edit-path-hint">
                将写入：<span className="lm-tool-args-edit-path-name">{pathLabel}</span>
              </p>
            ) : null}
            {extraEntries.length > 0 ? (
              <div className="lm-tool-args-edit-fields">
                {extraEntries.map(([key, value]) => (
                  <label key={key} className="lm-tool-args-edit-field">
                    <span>{FIELD_LABEL[key] ?? "相关内容"}</span>
                    <textarea
                      className="lm-tool-args-edit-textarea lm-tool-args-edit-textarea--field"
                      value={value}
                      disabled={busy}
                      onChange={(e) =>
                        setExtraFields((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      aria-label={FIELD_LABEL[key] ?? "相关内容"}
                      rows={key === "summary" || key === "note" || key === "reason" ? 4 : 2}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="lm-meta">暂无可改短字段，请关闭后直接批准或驳回。</p>
            )}
          </div>
        ) : editFullBody ? (
          <div className="lm-tool-args-edit-doc">
            {pathKey ? (
              <label className="lm-tool-args-edit-meta lm-tool-args-edit-meta--stack">
                <span>保存为</span>
                <input
                  type="text"
                  className="lm-input"
                  value={pathText}
                  disabled={busy}
                  onChange={(e) => setPathText(e.target.value)}
                  aria-label="保存位置"
                />
              </label>
            ) : null}
            <label className="lm-tool-args-edit-body-label">
              <span>正文</span>
              <textarea
                ref={bodyRef}
                className="lm-tool-args-edit-textarea lm-tool-args-edit-textarea--doc"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                aria-label="正文"
                spellCheck
                disabled={busy}
              />
            </label>
          </div>
        ) : (
          <div className="lm-tool-args-edit-fields">
            {extraEntries.length === 0 ? (
              <p className="lm-meta">暂无可调整的文字字段，请直接批准或驳回。</p>
            ) : (
              extraEntries.map(([key, value]) => (
                <label key={key} className="lm-tool-args-edit-field">
                  <span>{FIELD_LABEL[key] ?? "相关内容"}</span>
                  <textarea
                    className="lm-tool-args-edit-textarea lm-tool-args-edit-textarea--field"
                    value={value}
                    disabled={busy}
                    onChange={(e) =>
                      setExtraFields((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    aria-label={FIELD_LABEL[key] ?? "相关内容"}
                    rows={key === "summary" || key === "note" || key === "reason" ? 4 : 2}
                  />
                </label>
              ))
            )}
          </div>
        )}

        {displayError ? (
          <p className="lm-meta lm-tool-args-edit-error" role="alert">
            {displayError}
          </p>
        ) : null}

        <footer className="lm-tool-args-edit-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent"
            disabled={busy || (documentWrite && extraEntries.length === 0)}
            onClick={submit}
            data-testid="lm-tool-args-edit-approve"
          >
            按修改批准
          </button>
          <button type="button" className="lm-btn lm-btn-ghost" disabled={busy} onClick={onCancel}>
            取消
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
