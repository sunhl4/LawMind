/**
 * 会议室「设置区」：参会、议题、材料、选项与开始/控制 CTA（从 MatterTeamMeetingPanel 抽出）。
 */

import type { ReactNode } from "react";
import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { isAdhocMeetingMatterId } from "./lawmind-meeting-scope";
import type { LawyerMode, MeetingAssistantRow, MeetingPhase } from "./useMatterTeamMeetingDeliberation";
import { MatterTeamMeetingMaterialsSection } from "./MatterTeamMeetingMaterialsSection";

export type MatterTeamMeetingRunActionsProps = {
  phase: MeetingPhase;
  planLength: number;
  nextCueIndex: number;
  canStart: boolean;
  busy: boolean;
  participantCount: number;
  linesCount: number;
  startDeliberation: () => Promise<void>;
  interruptDeliberation: () => Promise<void>;
  resumeDeliberation: () => Promise<void>;
  concludeNow: () => Promise<void>;
  endDeliberation: () => void;
};

export function MatterTeamMeetingRunActions(props: MatterTeamMeetingRunActionsProps): ReactNode {
  const {
    phase,
    planLength,
    nextCueIndex,
    canStart,
    busy,
    participantCount,
    linesCount,
    startDeliberation,
    interruptDeliberation,
    resumeDeliberation,
    concludeNow,
    endDeliberation,
  } = props;

  return (
    <div className="lm-matter-meeting-run-actions">
      {phase === "idle" || (phase === "paused" && planLength === 0) ? (
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-matter-meeting-start"
          disabled={!canStart}
          onClick={() => void startDeliberation().catch(() => undefined)}
        >
          开始讨论
        </button>
      ) : null}
      {phase === "running" ? (
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-matter-meeting-interrupt"
          data-testid="lm-meeting-interrupt"
          onClick={() => void interruptDeliberation().catch(() => undefined)}
        >
          终止发言
        </button>
      ) : null}
      {phase === "paused" && planLength > 0 ? (
        <>
          {nextCueIndex < planLength ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent"
              disabled={busy}
              onClick={() => void resumeDeliberation().catch(() => undefined)}
            >
              继续讨论
            </button>
          ) : null}
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={busy}
            onClick={() => void concludeNow().catch(() => undefined)}
          >
            结束并要结论
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost"
            data-testid="lm-meeting-end"
            disabled={busy}
            onClick={endDeliberation}
            title="不调用模型，直接退出本轮讨论（记录保留）"
          >
            结束讨论
          </button>
        </>
      ) : null}
      {phase === "idle" && linesCount > 0 ? (
        <button
          type="button"
          className="lm-btn lm-btn-ghost"
          disabled={busy || participantCount === 0}
          onClick={() => void concludeNow().catch(() => undefined)}
        >
          仅根据现有记录出结论
        </button>
      ) : null}
    </div>
  );
}

export type MatterTeamMeetingSetupSectionProps = {
  matterId: string;
  apiBase: string;
  assistants: MeetingAssistantRow[];
  participantIds: string[];
  participantAssistants: MeetingAssistantRow[];
  agendaFilePins: FileChatContextItem[];
  onAddAgendaFile?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveAgendaFile?: (id: string) => void;
  busy: boolean;
  phase: MeetingPhase;
  deliberationActive: boolean;
  statusLabel: string | null;
  topic: string;
  onTopicChange: (value: string) => void;
  rounds: number;
  onRoundsChange: (value: number) => void;
  synthesizerId: string;
  onSynthesizerChange: (value: string) => void;
  lawyerMode: LawyerMode;
  onLawyerModeChange: (mode: LawyerMode) => void;
  allowMeetingWebSearch: boolean;
  onAllowMeetingWebSearchChange: (value: boolean) => void;
  rosterBusy: boolean;
  rosterHint: string | null;
  onRememberRoster: () => void;
  toggleParticipant: (id: string) => void;
  startBlockedHint: string | null;
  runActions: ReactNode;
};

export function MatterTeamMeetingSetupSection(props: MatterTeamMeetingSetupSectionProps): ReactNode {
  const {
    matterId,
    apiBase,
    assistants,
    participantIds,
    participantAssistants,
    agendaFilePins,
    onAddAgendaFile,
    onRemoveAgendaFile,
    busy,
    phase,
    deliberationActive,
    statusLabel,
    topic,
    onTopicChange,
    rounds,
    onRoundsChange,
    synthesizerId,
    onSynthesizerChange,
    lawyerMode,
    onLawyerModeChange,
    allowMeetingWebSearch,
    onAllowMeetingWebSearchChange,
    rosterBusy,
    rosterHint,
    onRememberRoster,
    toggleParticipant,
    startBlockedHint,
    runActions,
  } = props;

  return (
    <section
      className={`lm-matter-meeting-setup${deliberationActive ? " lm-matter-meeting-setup--live" : ""}`}
      aria-label="会议设置"
    >
      <div className="lm-matter-meeting-section">
        <div className="lm-matter-meeting-section-head">
          <h3 className="lm-matter-meeting-section-title">参加讨论</h3>
          <span className="lm-matter-meeting-section-meta">
            已选 {participantAssistants.length}
            {assistants.length > 0 ? ` / ${assistants.length}` : ""}
          </span>
        </div>
        {assistants.length === 0 ? (
          <p className="lm-meta">加载助手列表…</p>
        ) : (
          <div className="lm-matter-meeting-chip-list" role="group" aria-label="勾选参加讨论的助手">
            {assistants.map((a) => {
              const checked = participantIds.includes(a.assistantId);
              const cannotUncheck = checked && participantIds.length <= 1;
              return (
                <button
                  key={a.assistantId}
                  type="button"
                  className={`lm-matter-meeting-chip${checked ? " is-on" : ""}`}
                  aria-pressed={checked}
                  disabled={busy || phase === "running" || cannotUncheck}
                  onClick={() => toggleParticipant(a.assistantId)}
                >
                  {a.displayName}
                </button>
              );
            })}
          </div>
        )}
        <label className="lm-matter-meeting-web-toggle">
          <input
            type="checkbox"
            data-testid="lm-meeting-allow-web"
            checked={allowMeetingWebSearch}
            disabled={busy || phase === "running"}
            onChange={(e) => onAllowMeetingWebSearchChange(e.target.checked)}
          />
          <span>允许本场联网检索（默认关）</span>
        </label>
        {!isAdhocMeetingMatterId(matterId) ? (
          <div className="lm-matter-meeting-roster-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-meeting-remember-roster"
              disabled={busy || rosterBusy || phase === "running" || participantIds.length === 0}
              onClick={() => void onRememberRoster()}
            >
              记住本案编制
            </button>
            {rosterHint ? <span className="lm-meta">{rosterHint}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="lm-matter-meeting-section">
        <label className="lm-matter-meeting-field lm-matter-meeting-topic-field">
          <span className="lm-matter-meeting-section-title">讨论议题</span>
          <textarea
            className="lm-matter-meeting-agenda"
            rows={deliberationActive ? 2 : 4}
            value={topic}
            onChange={(e) => onTopicChange(e.target.value)}
            placeholder="本案和解空间、证据缺口与下一步…"
            disabled={phase === "running" || busy}
          />
        </label>
      </div>

      <MatterTeamMeetingMaterialsSection
        apiBase={apiBase}
        matterId={matterId}
        agendaFilePins={agendaFilePins}
        onAddAgendaFile={onAddAgendaFile}
        onRemoveAgendaFile={onRemoveAgendaFile}
      />

      <div className="lm-matter-meeting-section lm-matter-meeting-options">
        <div className="lm-matter-meeting-options-grid">
          <label className="lm-matter-meeting-field">
            <span className="lm-matter-meeting-label">轮次</span>
            <select
              value={rounds}
              onChange={(e) => onRoundsChange(Number(e.target.value))}
              aria-label="讨论轮次"
              disabled={phase === "running" || busy}
            >
              <option value={1}>1 轮</option>
              <option value={2}>2 轮（推荐）</option>
              <option value={3}>3 轮</option>
            </select>
          </label>
          <label className="lm-matter-meeting-field">
            <span className="lm-matter-meeting-label">写结论</span>
            <select
              value={synthesizerId}
              onChange={(e) => onSynthesizerChange(e.target.value)}
              aria-label="综合结论的助手"
              disabled={phase === "running" || busy || participantAssistants.length === 0}
            >
              {participantAssistants.map((a) => (
                <option key={a.assistantId} value={a.assistantId}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="lm-matter-meeting-segment" role="radiogroup" aria-label="律师介入">
          <button
            type="button"
            className={`lm-matter-meeting-segment-btn${lawyerMode === "later" ? " is-on" : ""}`}
            aria-checked={lawyerMode === "later"}
            role="radio"
            disabled={phase === "running"}
            onClick={() => onLawyerModeChange("later")}
          >
            先讨论
          </button>
          <button
            type="button"
            className={`lm-matter-meeting-segment-btn${lawyerMode === "open" ? " is-on" : ""}`}
            aria-checked={lawyerMode === "open"}
            role="radio"
            disabled={phase === "running"}
            onClick={() => onLawyerModeChange("open")}
          >
            我先发言
          </button>
        </div>
      </div>

      {!deliberationActive ? (
        <>
          {statusLabel ? (
            <div className="lm-matter-meeting-status" role="status" aria-live="polite">
              {statusLabel}
            </div>
          ) : null}
          <div className="lm-matter-meeting-cta">
            {runActions}
            {startBlockedHint ? (
              <p className="lm-matter-meeting-cta-hint">{startBlockedHint}</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="lm-matter-meeting-setup-live-hint lm-meta">
          主看置顶操作与下方记录；议题材料仍可追加。
        </p>
      )}
    </section>
  );
}
