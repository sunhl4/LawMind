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
          aria-label="工具参数 JSON"
        />
      ) : null}
      <div className="lm-requires-action-actions">
        {!editing ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            修改参数
          </button>
        ) : null}
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
          {editing ? "修改后批准" : "批准并继续"}
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          onClick={() => void onRejectTool?.(action)}
        >
          暂不执行
        </button>
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
    busy = false,
  } = props;

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="lm-requires-action-stack" role="region" aria-label="待您处理">
      {actions.map((action) => (
        <article key={action.id} className="lm-requires-action-card">
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
    </div>
  );
}
