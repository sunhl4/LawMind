import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { ApiRequestError, apiGetJson, errorMessage } from "./api-client";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { handleEnterSendShiftNewline } from "./lawmind-chat";
import {
  buildDeliberationPlan,
  formatDeliberationStatus,
  type DeliberationCue,
  type MeetingTurnKind,
} from "./lawmind-meeting-deliberation";
import {
  buildMeetingAgenda,
  formatMeetingMaterialsSystemText,
  sendMeetingChatTurn,
} from "./lawmind-meeting-chat";
import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { formatFileChatContextPill } from "./lawmind-file-chat-context";
import { isAdhocMeetingMatterId } from "./lawmind-meeting-scope";
import { LawmindComposeContextPicker } from "./LawmindComposeContextPicker";
type AssistantRow = { assistantId: string; displayName: string };

const SESSION_STORAGE_PREFIX = "lawmind.teamMeeting.session.";
const PARTICIPANTS_STORAGE_PREFIX = "lawmind.teamMeeting.participants.";
const TIMELINE_PAGE_LIMIT = 120;

type LawyerMode = "open" | "later";
type Phase = "idle" | "running" | "paused";

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

function readParticipants(matterId: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(`${PARTICIPANTS_STORAGE_PREFIX}${matterId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return null;
  }
}

function writeParticipants(matterId: string, ids: string[]): void {
  try {
    sessionStorage.setItem(`${PARTICIPANTS_STORAGE_PREFIX}${matterId}`, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function authorLabel(row: TeamMeetingLine): string {
  if (row.kind === "user") {
    return "您";
  }
  if (row.kind === "system") {
    return "主持人";
  }
  return row.displayName?.trim() || row.assistantId || "助手";
}

type Props = {
  apiBase: string;
  matterId: string;
  /** 外壳当前助手：默认列入参会 */
  shellAssistantId: string;
  projectDir?: string | null;
  /** Pins from 对话「引用到对话」— injected into meetingAgenda for each turn. */
  agendaFilePins?: FileChatContextItem[];
  onAddAgendaFile?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveAgendaFile?: (id: string) => void;
};

export function MatterTeamMeetingPanel(props: Props): ReactNode {
  const {
    apiBase,
    matterId,
    shellAssistantId,
    projectDir,
    agendaFilePins = [],
    onAddAgendaFile,
    onRemoveAgendaFile,
  } = props;

  const [assistants, setAssistants] = useState<AssistantRow[]>([]);
  const [participantIds, setParticipantIds] = useState<string[]>(() => {
    const stored = readParticipants(matterId);
    return stored?.length ? stored : [shellAssistantId];
  });
  const [lines, setLines] = useState<TeamMeetingLine[]>([]);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState("");
  const [rounds, setRounds] = useState(2);
  const [lawyerMode, setLawyerMode] = useState<LawyerMode>("later");
  const [synthesizerId, setSynthesizerId] = useState(shellAssistantId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeliberationCue[]>([]);
  const [nextCueIndex, setNextCueIndex] = useState(0);
  const [materialsPickerOpen, setMaterialsPickerOpen] = useState(false);
  const [materialsPickerQuery, setMaterialsPickerQuery] = useState("");

  const [sessionByAssistant, setSessionByAssistant] = useState<Record<string, string | undefined>>(
    () => readMeetingSessionMap(matterId),
  );
  const [pendingClarification, setPendingClarification] = useState<{
    questions: ClarificationQuestion[];
    formKey: string;
    status?: string;
  } | null>(null);

  const pauseRequestedRef = useRef(false);
  const runGenRef = useRef(0);
  const sessionsRef = useRef(sessionByAssistant);
  sessionsRef.current = sessionByAssistant;

  useEffect(() => {
    setSessionByAssistant(readMeetingSessionMap(matterId));
    const stored = readParticipants(matterId);
    const nextParticipants = stored?.length ? stored : [shellAssistantId];
    setParticipantIds(nextParticipants);
    setSynthesizerId(
      nextParticipants.includes(shellAssistantId)
        ? shellAssistantId
        : (nextParticipants[0] ?? shellAssistantId),
    );
    setLoadErr(null);
    setSendErr(null);
    setTopic("");
    setTotalLines(null);
    setPendingClarification(null);
    setPhase("idle");
    setStatusLabel(null);
    setPlan([]);
    setNextCueIndex(0);
    pauseRequestedRef.current = false;
    runGenRef.current += 1;
  }, [matterId, shellAssistantId]);

  useEffect(() => {
    writeParticipants(matterId, participantIds);
  }, [matterId, participantIds]);

  const participantAssistants = useMemo(() => {
    const set = new Set(participantIds);
    return assistants.filter((a) => set.has(a.assistantId));
  }, [assistants, participantIds]);

  useEffect(() => {
    if (assistants.length === 0) {
      return;
    }
    const valid = new Set(assistants.map((a) => a.assistantId));
    setParticipantIds((prev) => {
      const kept = prev.filter((id) => valid.has(id));
      if (kept.length > 0) {
        return kept;
      }
      const fallback = valid.has(shellAssistantId) ? shellAssistantId : assistants[0].assistantId;
      return [fallback];
    });
  }, [assistants, shellAssistantId]);

  useEffect(() => {
    if (participantIds.length === 0) {
      return;
    }
    if (!participantIds.includes(synthesizerId)) {
      setSynthesizerId(participantIds[participantIds.length - 1]);
    }
  }, [participantIds, synthesizerId]);

  const toggleParticipant = useCallback((id: string) => {
    setParticipantIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          return prev;
        }
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  }, []);

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
      sessionsRef.current = next;
      writeMeetingSessionMap(matterId, next);
    },
    [matterId],
  );

  const applyTurnResult = useCallback(
    (
      result: Awaited<ReturnType<typeof sendMeetingChatTurn>>,
      sessionBase: Record<string, string | undefined>,
      forAssistantId: string,
    ): Record<string, string | undefined> => {
      let nextSessions = sessionBase;
      if (result.sessionId) {
        nextSessions = { ...sessionBase, [forAssistantId]: result.sessionId };
        persistSessions(nextSessions);
      }
      const msg = result.assistantMessage;
      const qs = msg.clarificationQuestions ?? [];
      if (qs.length > 0 || msg.status === "awaiting_clarification") {
        setPendingClarification({
          questions: qs,
          formKey: `${forAssistantId}-${Date.now()}`,
          status: msg.status,
        });
      } else {
        setPendingClarification(null);
      }
      return nextSessions;
    },
    [persistSessions],
  );

  const sendToAssistantWithClarifyPause = useCallback(
    async (
      text: string,
      assistantId: string,
      turnKind: MeetingTurnKind,
      sessions: Record<string, string | undefined>,
    ): Promise<{ sessions: Record<string, string | undefined>; needsLawyer: boolean }> => {
      const turnArgs = (sess: Record<string, string | undefined>) => ({
        apiBase,
        message: text,
        matterId,
        assistantId,
        sessionId: sess[assistantId],
        allowWebSearch: false as const,
        projectDir: projectDir ?? undefined,
        meetingAgenda: buildMeetingAgenda({ topic, filePins: agendaFilePins }),
        meetingTurnKind: turnKind,
      });
      let result: Awaited<ReturnType<typeof sendMeetingChatTurn>>;
      try {
        result = await sendMeetingChatTurn(turnArgs(sessions));
      } catch (e) {
        if (e instanceof ApiRequestError && e.body?.code === "session_assistant_mismatch") {
          const cleared = { ...sessions, [assistantId]: undefined };
          persistSessions(cleared);
          result = await sendMeetingChatTurn(turnArgs(cleared));
          const next = applyTurnResult(result, cleared, assistantId);
          const msg = result.assistantMessage;
          const needsLawyer =
            (msg.clarificationQuestions?.length ?? 0) > 0 || msg.status === "awaiting_clarification";
          return { sessions: next, needsLawyer };
        }
        throw e;
      }
      const next = applyTurnResult(result, sessions, assistantId);
      const msg = result.assistantMessage;
      const needsLawyer =
        (msg.clarificationQuestions?.length ?? 0) > 0 || msg.status === "awaiting_clarification";
      return { sessions: next, needsLawyer };
    },
    [agendaFilePins, apiBase, applyTurnResult, matterId, persistSessions, projectDir, topic],
  );

  const executeQueue = useCallback(
    async (cues: DeliberationCue[], startIndex: number, gen: number): Promise<"done" | "paused" | "error"> => {
      let sessions = sessionsRef.current;
      for (let i = startIndex; i < cues.length; i++) {
        if (gen !== runGenRef.current || pauseRequestedRef.current) {
          setNextCueIndex(i);
          setPhase("paused");
          setStatusLabel("已暂停。可发言介入，或继续讨论。");
          setBusy(false);
          return "paused";
        }
        const cue = cues[i];
        setNextCueIndex(i);
        setStatusLabel(formatDeliberationStatus(cue));
        try {
          const out = await sendToAssistantWithClarifyPause(
            cue.message,
            cue.assistantId,
            cue.meetingTurnKind,
            sessions,
          );
          sessions = out.sessions;
          await refreshTimeline();
          if (out.needsLawyer) {
            setNextCueIndex(i + 1);
            setPhase("paused");
            setStatusLabel("助手需要补充信息。请先回答，再继续讨论。");
            setBusy(false);
            return "paused";
          }
        } catch (e) {
          setSendErr(errorMessage(e, "讨论中断"));
          setPhase("paused");
          setNextCueIndex(i);
          setStatusLabel("出错已暂停。可重试继续或结束。");
          setBusy(false);
          return "error";
        }
      }
      setNextCueIndex(cues.length);
      setPhase("idle");
      setStatusLabel("讨论结束。下方已给出结论与工作计划。");
      setBusy(false);
      return "done";
    },
    [refreshTimeline, sendToAssistantWithClarifyPause],
  );

  const startDeliberation = useCallback(async () => {
    const topicText =
      topic.trim() ||
      (agendaFilePins.length > 0 ? "请围绕所附材料讨论要点、风险与下一步。" : "");
    if (!topicText || busy || phase === "running") {
      if (!topic.trim() && agendaFilePins.length === 0) {
        setSendErr("请先填写讨论议题，或在「对话」引用材料后再开始。");
      }
      return;
    }
    if (participantAssistants.length < 2) {
      setSendErr("请至少勾选两位助手参加讨论。");
      return;
    }
    if (lawyerMode === "open" && !input.trim()) {
      setSendErr("已选择「开场先由我发言」，请先写下开场意见再开始。");
      return;
    }
    const nextPlan = buildDeliberationPlan({
      participants: participantAssistants,
      topic: topicText,
      rounds,
      lawyerOpening: lawyerMode === "open" ? input.trim() : undefined,
      synthesizerId,
    });
    if (nextPlan.length === 0) {
      setSendErr("无法生成讨论计划，请检查议题与参会助手。");
      return;
    }
    pauseRequestedRef.current = false;
    const gen = ++runGenRef.current;
    setPlan(nextPlan);
    setNextCueIndex(0);
    setPhase("running");
    setBusy(true);
    setSendErr(null);
    setPendingClarification(null);
    if (lawyerMode === "open") {
      setInput("");
    }
    await executeQueue(nextPlan, 0, gen);
  }, [
    agendaFilePins,
    busy,
    executeQueue,
    input,
    lawyerMode,
    participantAssistants,
    phase,
    rounds,
    synthesizerId,
    topic,
  ]);

  const pauseDeliberation = useCallback(() => {
    if (phase !== "running") {
      return;
    }
    pauseRequestedRef.current = true;
    setStatusLabel("正在暂停（当前发言结束后生效）…");
  }, [phase]);

  const resumeDeliberation = useCallback(async () => {
    if (phase !== "paused" || busy || plan.length === 0) {
      return;
    }
    if (nextCueIndex >= plan.length) {
      setPhase("idle");
      setStatusLabel("讨论已结束。");
      return;
    }
    pauseRequestedRef.current = false;
    const gen = ++runGenRef.current;
    setPhase("running");
    setBusy(true);
    setSendErr(null);
    await executeQueue(plan, nextCueIndex, gen);
  }, [busy, executeQueue, nextCueIndex, phase, plan]);

  const concludeNow = useCallback(async () => {
    if (busy || participantAssistants.length === 0) {
      return;
    }
    const topicText = topic.trim() || "（请综合此前讨论）";
    const synth =
      participantAssistants.find((a) => a.assistantId === synthesizerId) ??
      participantAssistants[participantAssistants.length - 1];
    pauseRequestedRef.current = true;
    runGenRef.current += 1;
    setPhase("running");
    setBusy(true);
    setSendErr(null);
    setStatusLabel(`正在汇总结论与工作计划（${synth.displayName}）…`);
    try {
      await sendToAssistantWithClarifyPause(
        `讨论议题：${topicText}\n请基于上述讨论输出共识、分歧、工作计划与需律师拍板事项。`,
        synth.assistantId,
        "conclude",
        sessionsRef.current,
      );
      await refreshTimeline();
      setPhase("idle");
      setPlan([]);
      setNextCueIndex(0);
      setStatusLabel("已输出结论与工作计划。");
    } catch (e) {
      setSendErr(errorMessage(e, "汇总失败"));
      setPhase("paused");
      setStatusLabel("汇总失败，可重试。");
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    participantAssistants,
    refreshTimeline,
    sendToAssistantWithClarifyPause,
    synthesizerId,
    topic,
  ]);

  const sendLawyerIntervene = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || participantAssistants.length === 0) {
      return;
    }
    // 律师介入：发给下一位将发言的助手（或首位），时间线记「您」
    const target =
      plan[nextCueIndex]?.assistantId ??
      participantAssistants[0].assistantId;
    setBusy(true);
    setSendErr(null);
    try {
      const out = await sendToAssistantWithClarifyPause(text, target, "lawyer", sessionsRef.current);
      await refreshTimeline();
      setInput("");
      if (out.needsLawyer) {
        setPhase("paused");
        setStatusLabel("还需补充信息后再继续。");
      } else if (phase === "paused" && plan.length > 0 && nextCueIndex < plan.length) {
        setStatusLabel("已记录您的意见。可继续讨论，或直接要结论。");
      }
    } catch (e) {
      setSendErr(errorMessage(e, "发送失败"));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    input,
    nextCueIndex,
    participantAssistants,
    phase,
    plan,
    refreshTimeline,
    sendToAssistantWithClarifyPause,
  ]);

  const hasEarlier =
    totalLines !== null ? totalLines > lines.length : lines.length >= TIMELINE_PAGE_LIMIT;

  const canStart =
    !busy && phase !== "running" && topic.trim().length > 0 && participantAssistants.length >= 2;
  const composeEnabled = phase !== "running" && !busy;
  const showInterveneCompose = phase === "paused" || phase === "idle";

  return (
    <div className="lm-matter-meeting">
      <p className="lm-matter-meeting-intro">
        <strong>怎么用：</strong>勾选多位助手，写清议题，点「开始讨论」。助手会轮流发言，最后自动给出
        <strong>工作计划与结论</strong>。可选择开场先介入，或讨论中途暂停发言。
      </p>

      <fieldset className="lm-matter-meeting-participants" disabled={phase === "running"}>
        <legend className="lm-matter-meeting-label">参加讨论</legend>
        {assistants.length === 0 ? (
          <p className="lm-meta">加载助手列表…</p>
        ) : (
          <div className="lm-matter-meeting-participant-list" role="group" aria-label="勾选参加讨论的助手">
            {assistants.map((a) => {
              const checked = participantIds.includes(a.assistantId);
              return (
                <label key={a.assistantId} className="lm-matter-meeting-participant">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy || (checked && participantIds.length <= 1)}
                    onChange={() => toggleParticipant(a.assistantId)}
                  />
                  <span>{a.displayName}</span>
                </label>
              );
            })}
          </div>
        )}
        <p className="lm-meta lm-matter-meeting-hint">
          至少两位。讨论中他们互相对话；最后由指定助手综合结论。
        </p>
      </fieldset>

      <label className="lm-matter-meeting-field lm-matter-meeting-topic-field">
        <span className="lm-matter-meeting-label">讨论议题</span>
        <textarea
          className="lm-matter-meeting-agenda"
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：本案和解空间、证据缺口与下一步工作安排"
          disabled={phase === "running" || busy}
        />
      </label>
      <div className="lm-matter-meeting-materials" data-testid="lm-meeting-agenda-pins">
        <div className="lm-matter-meeting-materials-head">
          <span className="lm-matter-meeting-label">议题材料</span>
          {onAddAgendaFile ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              data-testid="lm-meeting-add-materials"
              disabled={phase === "running" || busy}
              onClick={() => {
                setMaterialsPickerQuery("");
                setMaterialsPickerOpen(true);
              }}
            >
              添加材料
            </button>
          ) : null}
        </div>
        {agendaFilePins.length > 0 ? (
          <ul className="lm-meeting-materials-list">
            {agendaFilePins.map((pin) => {
              const pill = formatFileChatContextPill(pin);
              return (
                <li key={pin.id}>
                  <span title={pill.title}>{pill.shortLabel}</span>
                  {onRemoveAgendaFile ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      aria-label={`移除 ${pill.title}`}
                      disabled={phase === "running" || busy}
                      onClick={() => onRemoveAgendaFile(pin.id)}
                    >
                      移除
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lm-meta lm-meeting-file-hint">
            {onAddAgendaFile
              ? "点「添加材料」搜索工作区文件，或先在「对话」引用。材料会注入每轮模型上下文。"
              : "需要对照材料时，先到「对话」用「引用到对话」挂上文件。"}
          </p>
        )}
        {agendaFilePins.length > 0 ? (
          <p className="lm-meta">{formatMeetingMaterialsSystemText(agendaFilePins)}</p>
        ) : null}
      </div>
      {onAddAgendaFile ? (
        <LawmindComposeContextPicker
          open={materialsPickerOpen}
          query={materialsPickerQuery}
          onQueryChange={setMaterialsPickerQuery}
          searchPlaceholder="搜索工作区文件名（至少 2 字）"
          apiBase={apiBase}
          contextMatterId={isAdhocMeetingMatterId(matterId) ? null : matterId}
          pinnedFiles={agendaFilePins}
          matters={[]}
          categories={["files"]}
          onSelectFile={(payload) => {
            onAddAgendaFile(payload);
            setMaterialsPickerOpen(false);
            setMaterialsPickerQuery("");
          }}
          onSelectMatter={() => {
            setMaterialsPickerOpen(false);
          }}
          onSelectTemplate={() => {
            setMaterialsPickerOpen(false);
          }}
          onClose={() => {
            setMaterialsPickerOpen(false);
            setMaterialsPickerQuery("");
          }}
        />
      ) : null}

      <div className="lm-matter-meeting-toolbar">
        <label className="lm-matter-meeting-field">
          <span className="lm-matter-meeting-label">轮次</span>
          <select
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            aria-label="讨论轮次"
            disabled={phase === "running" || busy}
          >
            <option value={1}>1 轮（每人说一次）</option>
            <option value={2}>2 轮（推荐）</option>
            <option value={3}>3 轮</option>
          </select>
        </label>
        <label className="lm-matter-meeting-field">
          <span className="lm-matter-meeting-label">谁来写结论</span>
          <select
            value={synthesizerId}
            onChange={(e) => setSynthesizerId(e.target.value)}
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
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm lm-matter-meeting-refresh"
          disabled={busy}
          onClick={() => void refreshTimeline()}
        >
          刷新
        </button>
      </div>

      <fieldset className="lm-matter-meeting-lawyer-mode" disabled={phase === "running"}>
        <legend className="lm-matter-meeting-label">律师介入时机</legend>
        <label className="lm-matter-meeting-participant">
          <input
            type="radio"
            name="lawyer-mode"
            checked={lawyerMode === "later"}
            onChange={() => setLawyerMode("later")}
          />
          <span>先让助手讨论，需要时我再介入</span>
        </label>
        <label className="lm-matter-meeting-participant">
          <input
            type="radio"
            name="lawyer-mode"
            checked={lawyerMode === "open"}
            onChange={() => setLawyerMode("open")}
          />
          <span>开场先由我发言，再开始讨论</span>
        </label>
      </fieldset>

      {statusLabel ? (
        <div className="lm-matter-meeting-status" role="status" aria-live="polite">
          {statusLabel}
        </div>
      ) : null}

      <div className="lm-matter-meeting-run-actions">
        {phase === "idle" || (phase === "paused" && plan.length === 0) ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={!canStart}
            onClick={() => void startDeliberation().catch(() => undefined)}
          >
            开始讨论
          </button>
        ) : null}
        {phase === "running" ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={pauseDeliberation}
          >
            暂停，我要发言
          </button>
        ) : null}
        {phase === "paused" && plan.length > 0 && nextCueIndex < plan.length ? (
          <>
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              disabled={busy}
              onClick={() => void resumeDeliberation().catch(() => undefined)}
            >
              继续讨论
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={busy}
              onClick={() => void concludeNow().catch(() => undefined)}
            >
              结束并要结论
            </button>
          </>
        ) : null}
        {phase === "idle" && lines.length > 0 ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy || participantAssistants.length === 0}
            onClick={() => void concludeNow().catch(() => undefined)}
          >
            仅根据现有记录出结论
          </button>
        ) : null}
      </div>

      <details className="lm-matter-meeting-details lm-matter-meeting-details-muted">
        <summary>记录保存在哪？</summary>
        <p className="lm-meta lm-matter-meeting-details-body">
          讨论记录：{" "}
          <code className="lm-md-code">
            {isAdhocMeetingMatterId(matterId)
              ? "meetings/adhoc/team-meeting.jsonl"
              : `cases/${matterId}/team-meeting.jsonl`}
          </code>
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
          <li className="lm-meta">还没有内容。勾选至少两位助手、写好议题，开始讨论。</li>
        ) : null}
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
              onApplyToInput={(t) => setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))}
              onSend={(payload) => {
                setInput(payload);
                void (async () => {
                  setBusy(true);
                  setSendErr(null);
                  try {
                    const target =
                      plan[Math.max(0, nextCueIndex - 1)]?.assistantId ??
                      participantAssistants[0]?.assistantId;
                    if (!target) {
                      return;
                    }
                    await sendToAssistantWithClarifyPause(
                      payload,
                      target,
                      "lawyer",
                      sessionsRef.current,
                    );
                    await refreshTimeline();
                    setInput("");
                    setPendingClarification(null);
                    setPhase("paused");
                    setStatusLabel("已补充。可继续讨论。");
                  } catch (e) {
                    setSendErr(errorMessage(e, "发送失败"));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          ) : (
            <p className="lm-clarify-card-fallback">请在下方输入并发送。</p>
          )}
        </div>
      ) : null}

      {showInterveneCompose ? (
        <div className="lm-matter-meeting-compose">
          <textarea
            className="lm-matter-meeting-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              lawyerMode === "open" && phase === "idle"
                ? "开场意见：写下你想先交代的背景或要求，再点「开始讨论」"
                : phase === "paused"
                  ? "中途介入：写下你的意见或指示，发送后可继续讨论"
                  : "可选：单独向助手补充一句（不启动整轮讨论）"
            }
            disabled={!composeEnabled}
            onKeyDown={(e) =>
              handleEnterSendShiftNewline(e, () => {
                if (phase === "paused" || (phase === "idle" && lawyerMode !== "open")) {
                  void sendLawyerIntervene().catch(() => undefined);
                }
              })
            }
          />
          <div className="lm-matter-meeting-compose-actions">
            {phase === "paused" || (phase === "idle" && lawyerMode !== "open") ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy || !input.trim()}
                onClick={() => void sendLawyerIntervene().catch(() => undefined)}
              >
                {busy ? "发送中…" : "发送我的意见"}
              </button>
            ) : null}
            {lawyerMode === "open" && phase === "idle" ? (
              <span className="lm-meta lm-matter-meeting-kbd-hint">
                开场内容写在上方，点「开始讨论」一并发出
              </span>
            ) : (
              <span className="lm-meta lm-matter-meeting-kbd-hint" title="Enter 发送，Shift+Enter 换行">
                Enter 发送 · Shift+Enter 换行
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="lm-meta lm-matter-meeting-compose-locked">讨论进行中… 需要说话时请先「暂停」。</p>
      )}
    </div>
  );
}
