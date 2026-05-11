import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { ApiRequestError, apiGetJson, errorMessage } from "./api-client";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { handleEnterSendShiftNewline } from "./lawmind-chat";
import { sendMeetingChatTurn } from "./lawmind-meeting-chat";

type AssistantRow = { assistantId: string; displayName: string };

const SESSION_STORAGE_PREFIX = "lawmind.teamMeeting.session.";
const TIMELINE_PAGE_LIMIT = 120;

function readMeetingSessionMap(matterId: string): Record<string, string | undefined> {
  try {
    const raw = sessionStorage.getItem(`${SESSION_STORAGE_PREFIX}${matterId}`);
    if (!raw) {
      return {};
    }
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string | undefined> = {};
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.trim()) {
          out[k] = v.trim();
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMeetingSessionMap(matterId: string, map: Record<string, string | undefined>): void {
  try {
    sessionStorage.setItem(`${SESSION_STORAGE_PREFIX}${matterId}`, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

type Props = {
  apiBase: string;
  matterId: string;
  /** 外壳当前助手：默认「谁来答」 */
  shellAssistantId: string;
  projectDir?: string | null;
};

export function MatterTeamMeetingPanel(props: Props): ReactNode {
  const { apiBase, matterId, shellAssistantId, projectDir } = props;

  const [assistants, setAssistants] = useState<AssistantRow[]>([]);
  const [lines, setLines] = useState<TeamMeetingLine[]>([]);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [agendaDraft, setAgendaDraft] = useState("");

  const [speakerId, setSpeakerId] = useState(shellAssistantId);
  const [sessionByAssistant, setSessionByAssistant] = useState<Record<string, string | undefined>>(
    () => readMeetingSessionMap(matterId),
  );
  const [pendingClarification, setPendingClarification] = useState<{
    questions: ClarificationQuestion[];
    formKey: string;
    status?: string;
  } | null>(null);

  useEffect(() => {
    setSessionByAssistant(readMeetingSessionMap(matterId));
    setSpeakerId(shellAssistantId);
    setLoadErr(null);
    setSendErr(null);
    setAgendaDraft("");
    setTotalLines(null);
    setPendingClarification(null);
  }, [matterId, shellAssistantId]);

  useEffect(() => {
    if (assistants.length === 0) {
      return;
    }
    const ids = new Set(assistants.map((a) => a.assistantId));
    if (!ids.has(speakerId)) {
      setSpeakerId(assistants[0].assistantId);
    }
  }, [assistants, speakerId]);

  useEffect(() => {
    setPendingClarification(null);
  }, [speakerId]);

  const loadAssistants = useCallback(async () => {
    try {
      const j = await apiGetJson<{ ok?: boolean; assistants?: AssistantRow[] }>(
        apiBase,
        "/api/assistants",
      );
      if (!j.ok || !Array.isArray(j.assistants)) {
        setAssistants([]);
        return;
      }
      setAssistants(
        j.assistants.map((a) => ({
          assistantId: a.assistantId,
          displayName: a.displayName?.trim() || a.assistantId,
        })),
      );
    } catch {
      setAssistants([]);
    }
  }, [apiBase]);

  const fetchMeetingWindow = useCallback(
    async (skipFromEnd: number) => {
      return apiGetJson<{ ok?: boolean; lines?: TeamMeetingLine[]; total?: number }>(
        apiBase,
        `/api/matters/team-meeting?matterId=${encodeURIComponent(matterId)}&limit=${TIMELINE_PAGE_LIMIT}&skipFromEnd=${skipFromEnd}`,
      );
    },
    [apiBase, matterId],
  );

  const refreshTimeline = useCallback(async () => {
    setLoadErr(null);
    try {
      const j = await fetchMeetingWindow(0);
      if (!j.ok || !Array.isArray(j.lines)) {
        throw new Error("无效响应");
      }
      setLines(j.lines);
      setTotalLines(typeof j.total === "number" ? j.total : null);
    } catch (e) {
      setLoadErr(errorMessage(e, "加载记录失败"));
    }
  }, [fetchMeetingWindow]);

  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || lines.length === 0) {
      return;
    }
    const skip = lines.length;
    if (totalLines !== null && totalLines <= skip) {
      return;
    }
    setLoadingEarlier(true);
    setLoadErr(null);
    try {
      const j = await fetchMeetingWindow(skip);
      if (!j.ok || !Array.isArray(j.lines)) {
        throw new Error("无效响应");
      }
      const older = j.lines;
      if (older.length === 0) {
        if (typeof j.total === "number") {
          setTotalLines(j.total);
        }
        return;
      }
      setLines((prev) => [...older, ...prev]);
      if (typeof j.total === "number") {
        setTotalLines(j.total);
      }
    } catch (e) {
      setLoadErr(errorMessage(e, "加载更早内容失败"));
    } finally {
      setLoadingEarlier(false);
    }
  }, [fetchMeetingWindow, lines.length, loadingEarlier, totalLines]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  useEffect(() => {
    void refreshTimeline();
  }, [refreshTimeline]);

  const persistSessions = useCallback(
    (next: Record<string, string | undefined>) => {
      setSessionByAssistant(next);
      writeMeetingSessionMap(matterId, next);
    },
    [matterId],
  );

  const applyTurnResult = useCallback(
    (
      result: Awaited<ReturnType<typeof sendMeetingChatTurn>>,
      sessionBase: Record<string, string | undefined>,
    ) => {
      let nextSessions = sessionBase;
      if (result.sessionId) {
        nextSessions = { ...sessionBase, [speakerId]: result.sessionId };
        persistSessions(nextSessions);
      }
      const msg = result.assistantMessage;
      const qs = msg.clarificationQuestions ?? [];
      if (qs.length > 0 || msg.status === "awaiting_clarification") {
        setPendingClarification({
          questions: qs,
          formKey: `${speakerId}-${Date.now()}`,
          status: msg.status,
        });
      } else {
        setPendingClarification(null);
      }
    },
    [persistSessions, speakerId],
  );

  const runSendMeetingMessage = useCallback(
    async (rawMessage: string): Promise<boolean> => {
      const text = rawMessage.trim();
      if (!text || busy) {
        return false;
      }
      setBusy(true);
      setSendErr(null);
      const agenda = agendaDraft.trim() || undefined;
      const turnArgs = (sessions: Record<string, string | undefined>) => ({
        apiBase,
        message: text,
        matterId,
        assistantId: speakerId,
        sessionId: sessions[speakerId],
        allowWebSearch: false as const,
        projectDir: projectDir ?? undefined,
        meetingAgenda: agenda,
      });
      try {
        const result = await sendMeetingChatTurn(turnArgs(sessionByAssistant));
        applyTurnResult(result, sessionByAssistant);
        await refreshTimeline();
        return true;
      } catch (e) {
        if (e instanceof ApiRequestError && e.body?.code === "session_assistant_mismatch") {
          const cleared = { ...sessionByAssistant, [speakerId]: undefined };
          persistSessions(cleared);
          try {
            const result = await sendMeetingChatTurn(turnArgs(cleared));
            applyTurnResult(result, cleared);
            await refreshTimeline();
            return true;
          } catch (e2) {
            setSendErr(errorMessage(e2, "发送失败"));
            return false;
          }
        }
        setSendErr(errorMessage(e, "发送失败"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      agendaDraft,
      apiBase,
      applyTurnResult,
      busy,
      matterId,
      persistSessions,
      projectDir,
      refreshTimeline,
      sessionByAssistant,
      speakerId,
    ],
  );

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    const ok = await runSendMeetingMessage(text);
    if (ok) {
      setInput("");
    }
  }, [input, runSendMeetingMessage]);

  const hasEarlier =
    totalLines !== null ? totalLines > lines.length : lines.length >= TIMELINE_PAGE_LIMIT;

  return (
    <div className="lm-matter-meeting">
      <p className="lm-matter-meeting-intro">
        <strong>怎么用：</strong>先选「谁来答」，在下面写好你的话，点<strong>发送</strong>。你和助手的来回会留在
        <strong>本案</strong>里，下次打开还能看到。若助手反问几条待确认事项，会在下面出现<strong>待补充说明</strong>框，请按项填写后再发。
      </p>

      <div className="lm-matter-meeting-toolbar">
        <label className="lm-matter-meeting-field">
          <span className="lm-matter-meeting-label">谁来答</span>
          <select
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
            aria-label="由哪位助手回答"
          >
            {assistants.length === 0 ? (
              <option value={speakerId}>加载助手列表…</option>
            ) : (
              assistants.map((a) => (
                <option key={a.assistantId} value={a.assistantId}>
                  {a.displayName}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm lm-matter-meeting-refresh"
          disabled={busy}
          onClick={() => void refreshTimeline()}
        >
          刷新
        </button>
      </div>

      <details className="lm-matter-meeting-details">
        <summary>有时需要：给助手多看几句背景（可不填）</summary>
        <textarea
          className="lm-matter-meeting-agenda"
          rows={2}
          value={agendaDraft}
          onChange={(e) => setAgendaDraft(e.target.value)}
          placeholder="例如：今天主要想讨论和解方案"
          disabled={busy}
        />
      </details>

      <details className="lm-matter-meeting-details lm-matter-meeting-details-muted">
        <summary>固定流程、备份在哪？</summary>
        <p className="lm-meta lm-matter-meeting-details-body">
          重复性工作请用顶部<strong>协作 → 团队工作流</strong>。本页适合临时商量。
        </p>
        <p className="lm-meta lm-matter-meeting-details-body">
          记录文件（备份工作区时可一并带走）：{" "}
          <code className="lm-md-code">cases/{matterId}/team-meeting.jsonl</code>
        </p>
      </details>

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
            onClick={() => void loadEarlier()}
          >
            {loadingEarlier ? "加载中…" : "显示更早的对话"}
          </button>
        </div>
      ) : null}

      <ul className="lm-matter-meeting-feed" aria-label="本案讨论记录">
        {lines.length === 0 && !loadErr ? (
          <li className="lm-meta">还没有内容。写好上面的话，发一条试试。</li>
        ) : null}
        {lines.map((row) => (
          <li key={row.id} className={`lm-matter-meeting-row lm-matter-meeting-row-${row.kind}`}>
            <div className="lm-matter-meeting-row-meta">
              <time dateTime={row.ts}>{new Date(row.ts).toLocaleString()}</time>
              <span className="lm-matter-meeting-author">
                {row.kind === "user"
                  ? "您"
                  : row.kind === "system"
                    ? "系统"
                    : row.displayName?.trim() || row.assistantId || "助手"}
              </span>
            </div>
            <div className="lm-matter-meeting-text">{row.text}</div>
          </li>
        ))}
      </ul>

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
            {pendingClarification.status === "awaiting_clarification" &&
            (pendingClarification.questions?.length ?? 0) === 0
              ? "请把情况写在下面大框里，再点「发送」。"
              : "填好后可点「填好并发送」，或把内容放到下面大框自行修改后再发。"}
          </div>
          {pendingClarification.questions.length > 0 ? (
            <LawmindClarificationForm
              formKey={pendingClarification.formKey}
              questions={pendingClarification.questions}
              loading={busy}
              onApplyToInput={(t) => setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))}
              onSend={(payload) => void runSendMeetingMessage(payload)}
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
          onChange={(e) => setInput(e.target.value)}
          placeholder="写你想让助手做的事，例如：请把本案争议焦点整理成三条"
          disabled={busy}
          onKeyDown={(e) =>
            handleEnterSendShiftNewline(e, () => void onSend().catch(() => undefined))
          }
        />
        <div className="lm-matter-meeting-compose-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy || !input.trim()}
            onClick={() => void onSend().catch(() => undefined)}
          >
            {busy ? "发送中…" : "发送"}
          </button>
          <span className="lm-meta lm-matter-meeting-kbd-hint" title="Enter 发送，Shift+Enter 换行">
            Enter 发送 · Shift+Enter 换行
          </span>
        </div>
      </div>
    </div>
  );
}
