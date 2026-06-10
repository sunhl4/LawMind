import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import type { WorkflowTemplateItem } from "./LawmindWorkflowLibrary";
import {
  sortWorkflowTemplatesForLawyer,
  workflowTemplateKindLabel,
} from "./lawmind-workflow-display";

type Props = {
  open: boolean;
  apiBase?: string;
  onClose: () => void;
  onApplyStarterPrompt: (prompt: string) => void;
};

export function LawmindComposeTemplateGallery(props: Props): ReactNode {
  const { open, apiBase, onClose, onApplyStarterPrompt } = props;
  const [templates, setTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) {
      return templates;
    }
    return sortWorkflowTemplatesForLawyer(templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.deliverableType ?? "").toLowerCase().includes(q),
    ), { preferOffice: true });
  }, [templates, filter]);

  if (!open) {
    return null;
  }

  return (
    <div className="lm-compose-template-gallery-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lm-compose-template-gallery"
        role="dialog"
        aria-label="写文稿或做材料"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="lm-compose-template-gallery-head">
          <h3>写文稿 / 做材料</h3>
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
          <p className="lm-meta">暂无匹配模板。可在工作区 `lawmind/workflows/` 添加 JSON。</p>
        ) : (
          <ul className="lm-compose-template-gallery-list">
            {filtered.map((t) => (
              <li key={t.id} className="lm-compose-template-gallery-card">
                <div>
                  <strong>{t.name}</strong>
                  <p className="lm-meta">{workflowTemplateKindLabel(t)} · {t.description}</p>
                </div>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-small"
                  disabled={!t.starterPrompt?.trim()}
                  title={t.starterPrompt?.trim() ? "将提示填入输入框" : "该模板未配置 starterPrompt"}
                  onClick={() => {
                    if (t.starterPrompt?.trim()) {
                      onApplyStarterPrompt(t.starterPrompt.trim());
                      onClose();
                    }
                  }}
                >
                  带入对话
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
