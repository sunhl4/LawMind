import { useState, type ReactNode } from "react";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";

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
  onApproveTool?: (action: LawMindRequiresAction) => void | Promise<void>;
  onApproveToolEdit?: (
    action: LawMindRequiresAction,
    editedArgs: Record<string, unknown>,
  ) => void | Promise<void>;
  onRejectTool?: (action: LawMindRequiresAction) => void | Promise<void>;
}): ReactNode {
  const { action, busy, onApproveTool, onApproveToolEdit, onRejectTool } = props;
  const [editing, setEditing] = useState(false);
  const [argsJson, setArgsJson] = useState(
    () => JSON.stringify(action.toolArgs ?? {}, null, 2),
  );
  return (
    <>
      {editing ? (
        <textarea
          className="lm-input lm-requires-action-args-edit"
          rows={4}
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          aria-label="高级：调整执行参数"
        />
      ) : null}
      <div className="lm-requires-action-actions">
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          disabled={busy}
          onClick={() => {
            if (editing && onApproveToolEdit) {
              try {
                const parsed = JSON.parse(argsJson) as Record<string, unknown>;
                void onApproveToolEdit(action, parsed);
              } catch {
                void onApproveTool?.(action);
              }
              return;
            }
            void onApproveTool?.(action);
          }}
        >
          {editing ? "按修改批准" : "批准并继续"}
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          onClick={() => void onRejectTool?.(action)}
        >
          暂不执行
        </button>
        {!editing ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            高级…
          </button>
        ) : (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消高级
          </button>
        )}
      </div>
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
  } = props;

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="lm-requires-action-stack" role="region" aria-label="待您拍板">
      {actions.map((action) => (
        <article key={action.id} className="lm-requires-action-card" data-testid="lm-decision-card">
          <h4 className="lm-requires-action-title">{action.title}</h4>
          <p className="lm-meta lm-requires-action-summary">{action.summary}</p>

          {action.kind === "clarification" ? (
            <>
              <ClarificationFields
                questions={action.clarificationQuestions ?? []}
                draft={clarificationDraft}
                onChange={(key, value) => onClarificationDraftChange?.(key, value)}
              />
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
            </>
          ) : null}

          {action.kind === "tool_approval" ? (
            <ToolApprovalActions
              action={action}
              busy={busy}
              onApproveTool={onApproveTool}
              onApproveToolEdit={onApproveToolEdit}
              onRejectTool={onRejectTool}
            />
          ) : null}

          {action.kind === "matter_approval" && action.matterId && action.approvalId ? (
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
      ))}
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
