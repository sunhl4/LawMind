import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

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
};

/**
 * Lawyer-facing edit-before-approve dialog.
 * Prefers document body editing over raw JSON.
 */
export function LawmindToolArgsEditDialog(props: LawmindToolArgsEditDialogProps): ReactNode {
  const { open, toolArgs, busy = false, error = null, onCancel, onApprove } = props;
  const titleId = useId();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const baseArgs = useMemo(
    () => (toolArgs && typeof toolArgs === "object" ? { ...toolArgs } : {}),
    [toolArgs],
  );
  const bodyKey = bodyKeyOf(baseArgs);
  const pathKey = pathKeyOf(baseArgs);
  const isDocument = bodyKey != null;

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
    const t = window.setTimeout(() => bodyRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open, busy, onCancel]);

  if (!open) {
    return null;
  }

  const displayError = localError ?? error;
  const pathLabel = pathText ? basenameLabel(pathText) : "";

  const submit = () => {
    if (isDocument && !bodyText.trim()) {
      setLocalError("文书正文不能为空。");
      return;
    }
    const next: Record<string, unknown> = { ...baseArgs };
    if (bodyKey) {
      next[bodyKey] = bodyText;
    }
    if (pathKey) {
      next[pathKey] = pathText.trim();
    }
    for (const [key, value] of Object.entries(extraFields)) {
      next[key] = value;
    }
    setLocalError(null);
    onApprove(next);
  };

  return (
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
        className="lm-wizard lm-wizard--detail lm-tool-args-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="lm-tool-args-edit-dialog"
      >
        <header className="lm-tool-args-edit-head">
          <div>
            <h2 id={titleId}>改拟稿</h2>
            <p className="lm-meta lm-tool-args-edit-lead">
              直接改文书正文后批准。日常签批请用底栏「批准」；此处仅在需要改细节时使用。
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

        {isDocument ? (
          <div className="lm-tool-args-edit-doc">
            {pathKey ? (
              <label className="lm-tool-args-edit-meta">
                <span>保存为</span>
                <input
                  type="text"
                  className="lm-input"
                  value={pathText}
                  disabled={busy}
                  onChange={(e) => setPathText(e.target.value)}
                  aria-label="保存位置"
                />
                {pathLabel ? <span className="lm-meta">{pathLabel}</span> : null}
              </label>
            ) : null}
            <label className="lm-tool-args-edit-body-label">
              <span>文书正文</span>
              <textarea
                ref={bodyRef}
                className="lm-tool-args-edit-textarea lm-tool-args-edit-textarea--doc"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                aria-label="文书正文"
                spellCheck
                disabled={busy}
              />
            </label>
          </div>
        ) : (
          <div className="lm-tool-args-edit-fields">
            {Object.keys(extraFields).length === 0 ? (
              <p className="lm-meta">暂无可调整的文字字段，请直接批准或驳回。</p>
            ) : (
              Object.entries(extraFields).map(([key, value]) => (
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
                    rows={key === "summary" || key === "note" || key === "reason" ? 6 : 3}
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
            disabled={busy}
            onClick={submit}
            data-testid="lm-tool-args-edit-approve"
          >
            按修改批准
          </button>
          <button type="button" className="lm-btn lm-btn-ghost" disabled={busy} onClick={onCancel}>
            取消调整
          </button>
        </footer>
      </div>
    </div>
  );
}
