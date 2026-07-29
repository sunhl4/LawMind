/**
 * 会议室「讨论记录」：时间线、澄清表单与律师输入（从 MatterTeamMeetingPanel 抽出）。
 */

import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import type { ReactNode } from "react";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { handleEnterSendShiftNewline } from "./lawmind-chat";
import { meetingAuthorLabel as authorLabel } from "./lawmind-meeting-session-storage";
import type { LawyerMode, MeetingPhase } from "./useMatterTeamMeetingDeliberation";

export type MatterTeamMeetingThreadSectionProps = {
  lines: TeamMeetingLine[];
  loadErr: string | null;
  sendErr: string | null;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  busy: boolean;
  phase: MeetingPhase;
  lawyerMode: LawyerMode;
  composeEnabled: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onRefreshTimeline: () => void;
  onLoadEarlier: () => void;
  pendingClarification: {
    questions: ClarificationQuestion[];
    formKey: string;
    status?: string;
  } | null;
  onApplyClarificationToInput: (text: string) => void;
  onSendClarificationReply: (payload: string) => void;
  onSendLawyerIntervene: () => Promise<void>;
};

export function MatterTeamMeetingThreadSection(props: MatterTeamMeetingThreadSectionProps): ReactNode {
  const {
    lines,
    loadErr,
    sendErr,
    hasEarlier,
    loadingEarlier,
    busy,
    phase,
    lawyerMode,
    composeEnabled,
    input,
    onInputChange,
    onRefreshTimeline,
    onLoadEarlier,
    pendingClarification,
    onApplyClarificationToInput,
    onSendClarificationReply,
    onSendLawyerIntervene,
  } = props;

  return (
    <section className="lm-matter-meeting-thread" aria-label="讨论记录">
      <div className="lm-matter-meeting-thread-head">
        <h3 className="lm-matter-meeting-section-title">讨论记录</h3>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          disabled={busy}
          onClick={() =>  onRefreshTimeline()}
          title="刷新记录"
        >
          刷新
        </button>
      </div>

      {loadErr ? (
        <div className="lm-callout lm-callout-warn" role="alert">
          <p className="lm-callout-body">{loadErr}</p>
        </div>
      ) : null}

      {hasEarlier ? (
        <div className="lm-matter-meeting-load-earlier">
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={loadingEarlier || busy}
            onClick={() =>  onLoadEarlier()}
          >
            {loadingEarlier ? "加载中…" : "显示更早的对话"}
          </button>
        </div>
      ) : null}

      {lines.length === 0 && !loadErr ? (
        <div className="lm-matter-meeting-empty">讨论开始后，发言会出现在这里</div>
      ) : (
        <ul className="lm-matter-meeting-feed" aria-label="本案讨论记录">
          {lines.map((row) => (
            <li key={row.id} className={`lm-matter-meeting-row lm-matter-meeting-row-${row.kind}`}>
              <div className="lm-matter-meeting-row-meta">
                <time dateTime={row.ts}>{new Date(row.ts).toLocaleString()}</time>
                <span className="lm-matter-meeting-author">{authorLabel(row)}</span>
              </div>
              <div className="lm-matter-meeting-text">{row.text}</div>
            </li>
          ))}
        </ul>
      )}

      {sendErr ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{sendErr}</p>
        </div>
      ) : null}

      {pendingClarification ? (
        <div className="lm-clarify-card lm-matter-meeting-clarify" role="region" aria-label="待补充说明">
          <div className="lm-clarify-card-title">
            {pendingClarification.status === "awaiting_clarification"
              ? "还差这些信息"
              : "建议补充这些"}
          </div>
          <div className="lm-clarify-card-hint">
            填好后发送；讨论会暂停在此处，补完后再点「继续讨论」。
          </div>
          {pendingClarification.questions.length > 0 ? (
            <LawmindClarificationForm
              formKey={pendingClarification.formKey}
              questions={pendingClarification.questions}
              loading={busy}
              variant="chat"
              onApplyToInput={onApplyClarificationToInput}
              onSend={(payload) => {
                onInputChange(payload);
                 onSendClarificationReply(payload);
              }}
            />
          ) : (
            <p className="lm-clarify-card-fallback">请在下方输入并发送。</p>
          )}
        </div>
      ) : null}

      <div className="lm-matter-meeting-compose">
        <textarea
          className="lm-matter-meeting-input"
          rows={3}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={
            lawyerMode === "open" && phase === "idle"
              ? "开场意见（随「开始讨论」一并发出）"
              : phase === "running"
                ? "补充意见（发送时终止当前发言）"
                : phase === "paused"
                  ? "写下你的意见或指示"
                  : "可选：单独补充一句"
          }
          disabled={!composeEnabled}
          onKeyDown={(e) =>
            handleEnterSendShiftNewline(e, () => {
              if (
                phase === "running" ||
                phase === "paused" ||
                (phase === "idle" && lawyerMode !== "open")
              ) {
                void onSendLawyerIntervene().catch(() => undefined);
              }
            })
          }
        />
        <div className="lm-matter-meeting-compose-actions">
          {phase === "paused" || (phase === "idle" && lawyerMode !== "open") ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-meeting-send-intervene"
              disabled={busy || !input.trim()}
              onClick={() => void onSendLawyerIntervene().catch(() => undefined)}
            >
              {busy ? "发送中…" : "发送意见"}
            </button>
          ) : null}
          {phase === "running" && input.trim() ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              data-testid="lm-meeting-send-intervene"
              onClick={() => void onSendLawyerIntervene().catch(() => undefined)}
            >
              终止并补充
            </button>
          ) : null}
          {lawyerMode === "open" && phase === "idle" ? (
            <span className="lm-meta lm-matter-meeting-kbd-hint">随「开始讨论」发出</span>
          ) : phase === "running" ? (
            <span className="lm-meta lm-matter-meeting-kbd-hint">
              {input.trim() ? "Enter 终止并写入意见" : "无需发言时点上方「终止发言」"}
            </span>
          ) : (
            <span className="lm-meta lm-matter-meeting-kbd-hint">Enter 发送</span>
          )}
        </div>
      </div>
    </section>
  );
}
