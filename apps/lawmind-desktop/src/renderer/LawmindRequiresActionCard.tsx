import { useState, type ReactNode } from "react";
import type { LawMindRequiresAction } from "./lawmind-requires-action";
import {
  formatToolArgsDiffPreview,
  toolArgsAreDocumentWrite,
  toolArgsHaveLawyerEditableShortFields,
  toolArgsLinkedTaskId,
} from "../../../../src/lawmind/platform/tool-approval-diff.ts";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import { LawmindToolArgsEditDialog } from "./LawmindToolArgsEditDialog";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import type { NeedsDecisionDeskTarget } from "./lawmind-agents-desk";

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
  onRespondClarification?: (
    action: LawMindRequiresAction,
    answers?: Record<string, string>,
  ) => void | Promise<void>;
  onResolveMatterApproval?: (
    action: LawMindRequiresAction,
    status: "approved" | "rejected",
  ) => void | Promise<void>;
  /** Jump to「在办」and focus the matching decision row. */
  onOpenNeedsDecisionDesk?: (target?: NeedsDecisionDeskTarget) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  busy?: boolean;
  /** 在办大阅读面已展示正文时：隐藏参数缩略与重复按钮 */
  deskReading?: boolean;
  /** 底部 dock 已提供批准/驳回时隐藏卡片内操作 */
  hideActions?: boolean;
  /** desk：在办全表；compact：对话短确认；hint：仅清单+去在办 */
  clarificationVariant?: "desk" | "compact" | "hint";
};

function RecommendationLine(props: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <p className="lm-meta" data-testid="lm-requires-action-recommendation">
      建议：{props.text}{" "}
      <button
        type="button"
        className="lm-link-btn"
        data-testid="lm-requires-action-recommendation-copy"
        onClick={() => {
          const clip = navigator.clipboard;
          if (!clip?.writeText) {
            return;
          }
          void clip.writeText(props.text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
    </p>
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
  onOpenNeedsDecisionDesk?: (target?: NeedsDecisionDeskTarget) => void;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
}): ReactNode {
  const {
    action,
    busy,
    deskReading,
    hideActions,
    onApproveTool,
    onApproveToolEdit,
    onRejectTool,
    onOpenNeedsDecisionDesk,
    onOpenReview,
  } = props;
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const toolArgs = action.toolArgs;
  const diffLines = deskReading ? [] : formatToolArgsDiffPreview(toolArgs);
  const docWrite = toolArgsAreDocumentWrite(toolArgs);
  const hasLawyerShortEdits = toolArgsHaveLawyerEditableShortFields(toolArgs);
  const hasEditableBody =
    !docWrite &&
    !!toolArgs &&
    (typeof toolArgs.body === "string" || typeof toolArgs.content === "string");
  const linkedTaskId = toolArgsLinkedTaskId(toolArgs);
  const showEdit = docWrite ? hasLawyerShortEdits : hasLawyerShortEdits || hasEditableBody;

  /** 在办阅读面：底栏已提供批准/驳回/改参数，此处不再渲染任何条带。 */
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
        {docWrite && linkedTaskId && (onOpenReview || onOpenNeedsDecisionDesk) ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy}
            data-testid="lm-requires-action-signoff"
            onClick={() => {
              if (onOpenReview) {
                onOpenReview(linkedTaskId, action.matterId);
                return;
              }
              onOpenNeedsDecisionDesk?.({
                taskId: linkedTaskId,
                matterId: action.matterId,
                preferStatus: "awaiting_review",
              });
            }}
          >
            打开结果
          </button>
        ) : null}
        {showEdit ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => {
              setEditError(null);
              setEditing(true);
            }}
          >
            {docWrite ? "改参数…" : "改拟稿…"}
          </button>
        ) : null}
      </div>
      <LawmindToolArgsEditDialog
        open={editing}
        toolArgs={action.toolArgs}
        busy={busy}
        error={editError}
        matterId={action.matterId}
        onOpenReview={onOpenReview}
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
    sessionId,
    clarificationDraft = {},
    onClarificationDraftChange,
    onApproveTool,
    onApproveToolEdit,
    onRejectTool,
    onRespondClarification,
    onResolveMatterApproval,
    onOpenNeedsDecisionDesk,
    onOpenReview,
    busy = false,
    deskReading = false,
    hideActions = false,
    clarificationVariant = "desk",
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
          {action.recommendation?.trim() ? (
            <RecommendationLine text={action.recommendation.trim()} />
          ) : null}

          {action.kind === "clarification" ? (
            clarificationVariant === "hint" ? (
              <div className="lm-clarify-hint" data-testid="lm-clarify-hint">
                <p className="lm-meta">
                  还差 {(action.clarificationQuestions ?? []).length} 项，去在办补充。
                </p>
                <ul className="lm-clarify-weak-list">
                  {(action.clarificationQuestions ?? []).slice(0, 6).map((q) => (
                    <li key={q.key}>{q.question}</li>
                  ))}
                </ul>
                {onOpenNeedsDecisionDesk ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-accent lm-btn-sm"
                    data-testid="lm-clarify-open-desk"
                    disabled={busy}
                    onClick={() =>
                      onOpenNeedsDecisionDesk({
                        sessionId: action.sessionId ?? sessionId,
                        taskId: action.taskId,
                        matterId: action.matterId,
                        preferStatus: "awaiting_clarification",
                      })
                    }
                  >
                    去在办补充
                  </button>
                ) : null}
              </div>
            ) : (
              <LawmindClarificationForm
                formKey={`${action.id}-${sessionId ?? ""}`}
                questions={action.clarificationQuestions ?? []}
                loading={busy}
                variant={clarificationVariant === "compact" ? "compact" : "desk"}
                values={clarificationDraft}
                onValuesChange={(next) => {
                  for (const [key, value] of Object.entries(next)) {
                    if ((clarificationDraft?.[key] ?? "") !== value) {
                      onClarificationDraftChange?.(key, value);
                    }
                  }
                }}
                onSubmitAnswers={
                  hideActions
                    ? undefined
                    : (answers) => void onRespondClarification?.(action, answers)
                }
                onOpenDesk={
                  onOpenNeedsDecisionDesk
                    ? () =>
                        onOpenNeedsDecisionDesk({
                          sessionId: action.sessionId ?? sessionId,
                          taskId: action.taskId,
                          matterId: action.matterId,
                          preferStatus: "awaiting_clarification",
                        })
                    : undefined
                }
              />
            )
          ) : null}

          {action.kind === "continue_tools" && !hideActions ? (
            <div className="lm-requires-action-actions">
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                data-testid="lm-continue-tools-approve"
                disabled={busy}
                onClick={() => void onApproveTool?.(action)}
              >
                继续
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-continue-tools-stop"
                disabled={busy}
                onClick={() => void onRejectTool?.(action)}
              >
                先停在这里
              </button>
            </div>
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
              onOpenNeedsDecisionDesk={onOpenNeedsDecisionDesk}
              onOpenReview={onOpenReview}
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
            onClick={() => onOpenNeedsDecisionDesk?.()}
          >
            待我拍板
          </button>
        </p>
      ) : null}
    </div>
  );
}
