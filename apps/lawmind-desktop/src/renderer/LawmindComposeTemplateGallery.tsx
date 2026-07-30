import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { LawmindJobIntakeForm } from "./LawmindJobIntakeForm";
import type { WorkflowTemplateItem } from "./lawmind-workflow-types";
import {
  sortWorkflowTemplatesForLawyer,
  workflowTemplateSearchHaystack,
} from "./lawmind-workflow-display";
import { useModalFocusTrap } from "./use-modal-focus-trap";

type Props = {
  open: boolean;
  apiBase?: string;
  onClose: () => void;
  /** Fill composer only. */
  onApplyStarterPrompt: (prompt: string) => void;
  /**
   * Preferred path: structured intake → fill composer and send.
   * Parent should set input then call send.
   */
  onDispatchJob?: (prompt: string) => void;
};

export function LawmindComposeTemplateGallery(props: Props): ReactNode {
  const { open, apiBase, onClose, onApplyStarterPrompt, onDispatchJob } = props;
  const [templates, setTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [intakeTemplate, setIntakeTemplate] = useState<WorkflowTemplateItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(open, dialogRef);

  useEffect(() => {
    if (!open || !apiBase?.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    void apiGetJson<{ ok?: boolean; templates?: WorkflowTemplateItem[] }>(
      apiBase,
      "/api/collaboration/workflow-templates",
    )
      .then((r) => setTemplates(r.templates ?? []))
      .catch((e) => setError(errorMessage(e, "无法加载模板")))
      .finally(() => setLoading(false));
  }, [open, apiBase]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setIntakeTemplate(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (intakeTemplate) {
          setIntakeTemplate(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, intakeTemplate]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return sortWorkflowTemplatesForLawyer(templates, { preferOffice: true });
    }
    return sortWorkflowTemplatesForLawyer(
      templates.filter((t) => workflowTemplateSearchHaystack(t).includes(q)),
      { preferOffice: true },
    );
  }, [templates, filter]);

  if (!open) {
    return null;
  }

  return (
    <div className="lm-compose-template-gallery-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="lm-compose-template-gallery"
        role="dialog"
        aria-modal="true"
        aria-label="写文稿或做材料"
        onClick={(e) => e.stopPropagation()}
      >
        {intakeTemplate ? (
          <LawmindJobIntakeForm
            template={intakeTemplate}
            apiBase={apiBase}
            onCancel={() => setIntakeTemplate(null)}
            onFillComposer={(prompt) => {
              onApplyStarterPrompt(prompt);
              onClose();
            }}
            onDispatch={
              onDispatchJob
                ? (prompt) => {
                    onDispatchJob(prompt);
                    onClose();
                  }
                : undefined
            }
          />
        ) : (
          <>
            <header className="lm-compose-template-gallery-head">
              <div>
                <h3>写文稿 / 做材料</h3>
                <p className="lm-meta">选任务后填几项关键信息即可交办，不必写提示词。</p>
              </div>
              <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onClose}>
                关闭
              </button>
            </header>
            <input
              type="search"
              className="lm-input"
              placeholder="搜索 PPT、报告、讲稿、合同审查…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="搜索模板"
              autoFocus
            />
            {loading ? <p className="lm-meta">加载模板…</p> : null}
            {error ? <p className="lm-error">{error}</p> : null}
            {!loading && filtered.length === 0 ? (
              <p className="lm-meta">暂无匹配模板。请调整搜索，或请同事配置办案流程后再试。</p>
            ) : (
              <ul className="lm-compose-template-gallery-list">
                {filtered.map((t) => (
                  <li key={t.id} className="lm-compose-template-gallery-card">
                    <div>
                      <strong>{t.name}</strong>
                      {t.description.trim() ? (
                        <p className="lm-meta">{t.description}</p>
                      ) : null}
                    </div>
                    <div className="lm-compose-template-gallery-actions">
                      <button
                        type="button"
                        className="lm-btn lm-btn-small"
                        onClick={() => setIntakeTemplate(t)}
                      >
                        填表交办
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={!t.starterPrompt?.trim()}
                        title={
                          t.starterPrompt?.trim()
                            ? "把预设说明填入对话输入框"
                            : "该流程暂未提供对话说明"
                        }
                        onClick={() => {
                          if (t.starterPrompt?.trim()) {
                            onApplyStarterPrompt(t.starterPrompt.trim());
                            onClose();
                          }
                        }}
                      >
                        带入对话
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
