import { useState, type ReactNode } from "react";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { formatToolArgsDiffPreview } from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";

type Props = {
  actions: LawMindRequiresAction[];
  sessionId?: string;
  clarificationDraft?: Record<string, string>;
  onClarificationDraftChange?: (key: string, value: string) => void;
  onApproveTool?: (action: LawMindRequiresAction) => void | Promise<void>;
  onApproveToolEdit?: (
    action: LawMindRequiresAction,
    editedArgs: Record<string, unknown>,
  ) => void | Promise<void>;
  onRejectTool?: (action: LawMindRequiresAction) => void | Promise<void>;
  onRespondClarification?: (action: LawMindRequiresAction) => void | Promise<void>;
  onResolveMatterApproval?: (
    action: LawMindRequiresAction,
    status: "approved" | "rejected",
  ) => void | Promise<void>;
  /** Jump to「在办」needs-decision desk (single queue mental model). */
  onOpenNeedsDecisionDesk?: () => void;
  busy?: boolean;
  /** 在办大阅读面已展示正文时：隐藏参数缩略与重复按钮 */
  deskReading?: boolean;
  /** 底部 dock 已提供批准/驳回时隐藏卡片内操作 */
  hideActions?: boolean;
};

function ClarificationFields(props: {
  questions: ClarificationQuestion[];
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
}): ReactNode {
  const { questions, draft, onChange } = props;
  if (questions.length === 0) {
    return (
      <p className="lm-meta">请在下方的输入框补充说明后发送，或点击「已补充，继续」。</p>
    );
  }
  return (
    <ul className="lm-requires-action-clarify-list">
      {questions.map((q) => (
        <li key={q.key}>
          <label className="lm-meta">{q.question}</label>
          <input
            type="text"
            className="lm-input"
            value={draft[q.key] ?? ""}
            onChange={(e) => onChange(q.key, e.target.value)}
            placeholder="请填写"
          />
        </li>
      ))}
    </ul>
  );
}

function ToolApprovalActions(props: {
  action: LawMindRequiresAction;
  busy: boolean;
  deskReading?: boolean;
  hideActions?: boolean;
  onApproveTool?: (action: LawMindRequiresAction) => void | Promise<void>;
  onApproveToolEdit?: (
    action: LawMindRequiresAction,
    editedArgs: Record<string, unknown>,
  ) => void | Promise<void>;
  onRejectTool?: (action: LawMindRequiresAction) => void | Promise<void>;
}): ReactNode {
  const { action, busy, deskReading, hideActions, onApproveTool, onApproveToolEdit, onRejectTool } =
    props;
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const diffLines = deskReading ? [] : formatToolArgsDiffPreview(action.toolArgs);

  /** 在办阅读面：底栏已提供批准/驳回/改拟稿，此处不再渲染任何条带。 */
  if (deskReading && hideActions) {
    return null;
  }

  return (
    <>
      {diffLines.length > 0 && !editing ? (
        <pre
          className="lm-tool-args-diff lm-tool-args-diff--readable"
          data-testid="lm-tool-args-diff"
          aria-label="拟办理内容预览"
        >
          {diffLines.map((line) => (
            <div key={`${line.key}:${line.kind}`} className={`lm-tool-args-diff-line lm-tool-args-diff--${line.kind}`}>
              {line.kind === "truncated" ? line.value : `${line.key}：${line.value}`}
            </div>
          ))}
        </pre>
      ) : null}
      <div className={`lm-requires-action-actions${hideActions ? " lm-requires-action-actions--desk" : ""}`}>
        {!hideActions ? (
          <>
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy}
              onClick={() => void onApproveTool?.(action)}
            >
              批准并继续
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={busy}
              onClick={() => void onRejectTool?.(action)}
            >
              暂不办理
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          disabled={busy}
          onClick={() => {
            setEditError(null);
            setEditing(true);
          }}
        >
          改拟稿…
        </button>
      </div>
      <LawmindToolArgsEditDialog
        open={editing}
        toolArgs={action.toolArgs}
        busy={busy}
        error={editError}
        onCancel={() => {
          setEditing(false);
          setEditError(null);
        }}
        onApprove={(edited) => {
          setEditError(null);
          if (onApproveToolEdit) {
            void onApproveToolEdit(action, edited);
          } else {
            void onApproveTool?.(action);
          }
          setEditing(false);
        }}
      />
    </>
  );
}

export function LawmindRequiresActionCard(props: Props): ReactNode {
  const {
    actions,
    clarificationDraft = {},
    onClarificationDraftChange,
    onApproveTool,
    onApproveToolEdit,
    onRejectTool,
    onRespondClarification,
    onResolveMatterApproval,
    onOpenNeedsDecisionDesk,
    busy = false,
    deskReading = false,
    hideActions = false,
  } = props;

  if (actions.length === 0) {
    return null;
  }

  return (
    <div
      className={`lm-requires-action-stack${deskReading ? " lm-requires-action-stack--desk" : ""}`}
      role="region"
      aria-label="待您拍板"
    >
      {actions.map((action) => {
        const title = sanitizeLawyerFacingText(action.title, action.toolName);
        const summary = sanitizeLawyerFacingText(action.summary, action.toolName);
        return (
        <article
          key={action.id}
          className={`lm-requires-action-card${deskReading ? " lm-requires-action-card--desk" : ""}`}
          data-testid="lm-decision-card"
        >
          {deskReading ? null : (
            <>
              <h4 className="lm-requires-action-title">{title}</h4>
              <p className="lm-meta lm-requires-action-summary">{summary}</p>
            </>
          )}

          {action.kind === "clarification" ? (
            <>
              <ClarificationFields
                questions={action.clarificationQuestions ?? []}
                draft={clarificationDraft}
                onChange={(key, value) => onClarificationDraftChange?.(key, value)}
              />
              {hideActions ? null : (
                <div className="lm-requires-action-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    disabled={busy}
                    onClick={() => void onRespondClarification?.(action)}
                  >
                    已补充，继续
                  </button>
                </div>
              )}
            </>
          ) : null}

          {action.kind === "tool_approval" ? (
            <ToolApprovalActions
              action={action}
              busy={busy}
              deskReading={deskReading}
              hideActions={hideActions}
              onApproveTool={onApproveTool}
              onApproveToolEdit={onApproveToolEdit}
              onRejectTool={onRejectTool}
            />
          ) : null}

          {action.kind === "matter_approval" && action.matterId && action.approvalId && !hideActions ? (
            <div className="lm-requires-action-actions">
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy}
                onClick={() => void onResolveMatterApproval?.(action, "approved")}
              >
                批准
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy}
                onClick={() => void onResolveMatterApproval?.(action, "rejected")}
              >
                驳回
              </button>
            </div>
          ) : null}
        </article>
        );
      })}
      {onOpenNeedsDecisionDesk ? (
        <p className="lm-meta lm-requires-action-desk-hint">
          <button
            type="button"
            className="lm-link-btn"
            data-testid="lm-decision-card-open-desk"
            onClick={onOpenNeedsDecisionDesk}
          >
            也可在侧栏「待我拍板」集中处理
          </button>
        </p>
      ) : null}
    </div>
  );
}
