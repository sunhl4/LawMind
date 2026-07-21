import type { ReactNode } from "react";
import type { ApprovalDocumentPreview } from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";

export type LawmindApprovalDocReaderProps = {
  doc: ApprovalDocumentPreview;
  /** 顶栏已显示标题时不再重复 */
  showTitle?: boolean;
};

/**
 * 审批大阅读面：排版后的全文，供律师通读后批准。
 */
export function LawmindApprovalDocReader(props: LawmindApprovalDocReaderProps): ReactNode {
  const { doc, showTitle = false } = props;
  // 顶栏已有标题时，去掉正文首行 # 标题，避免重复
  let body = doc.body;
  if (!showTitle) {
    body = body.replace(/^#\s+[^\n]+\n+/, "");
  }

  return (
    <div className="lm-agents-wb-reader" data-testid="lm-approval-doc-reader">
      <article className="lm-agents-wb-reader-sheet">
        {showTitle ? <h3 className="lm-agents-wb-reader-title">{doc.title}</h3> : null}
        {doc.meta.length > 0 ? (
          <ul className="lm-agents-wb-reader-meta">
            {doc.meta.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="lm-agents-wb-reader-body lm-md" aria-label="拟落稿全文">
          {renderLegalMarkdown(body)}
        </div>
      </article>
    </div>
  );
}
