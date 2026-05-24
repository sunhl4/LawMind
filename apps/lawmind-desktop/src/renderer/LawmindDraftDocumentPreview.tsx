/**
 * 审核台文档预览 — 只读排版视图（与编辑区左右对照）。
 */

import { LawmindSourcePillList } from "./LawmindSourcePreview";
import type { DraftDocumentEditorValue } from "./lawmind-draft-document-editor";
import { resolveSourceAnchorId } from "./lawmind-source-anchor";

type Props = {
  taskId: string;
  apiBase: string;
  value: DraftDocumentEditorValue;
  outputPath?: string | null;
  reviewStatusLabel?: string;
};

export function LawmindDraftDocumentPreview(props: Props) {
  const { taskId, apiBase, value, outputPath, reviewStatusLabel } = props;

  return (
    <section className="lm-draft-doc-preview" aria-label="文档预览">
      <header className="lm-draft-doc-preview-header">
        <span className="lm-draft-doc-preview-kicker">交付预览</span>
        {reviewStatusLabel ? (
          <span className="lm-draft-doc-preview-status">{reviewStatusLabel}</span>
        ) : null}
      </header>
      <article className="lm-draft-doc-preview-body">
        <h1 className="lm-draft-doc-preview-title">{(value.title ?? "").trim() || "（无标题）"}</h1>
        {(value.summary ?? "").trim() ? (
          <div className="lm-draft-doc-preview-summary">
            <p className="lm-draft-doc-preview-summary-label">执行摘要</p>
            <p className="lm-draft-doc-preview-summary-text">{value.summary}</p>
          </div>
        ) : null}
        {value.sections.map((section, index) => {
          const citations = (section.citations ?? []).filter(Boolean);
          const key = `${index}-${section.heading.slice(0, 24)}`;
          return (
            <section
              key={key}
              id={resolveSourceAnchorId(taskId, section.heading)}
              className="lm-draft-doc-preview-section"
            >
              <h2 className="lm-draft-doc-preview-heading">{section.heading}</h2>
              <div className="lm-draft-doc-preview-text">{section.body || "（本节暂无正文）"}</div>
              {citations.length > 0 ? (
                <div className="lm-draft-section-cites">
                  <span className="lm-meta">引用：</span>
                  <LawmindSourcePillList apiBase={apiBase} taskId={taskId} sourceIds={citations} />
                </div>
              ) : null}
            </section>
          );
        })}
        {outputPath ? (
          <p className="lm-meta lm-draft-doc-preview-output">已有交付文件：{outputPath}</p>
        ) : null}
      </article>
    </section>
  );
}
