import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { ApiRequestError, apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { handleEnterSendShiftNewline } from "./lawmind-chat";
import {
  buildDeliberationPlan,
  formatDeliberationStatus,
  type DeliberationCue,
  type MeetingTurnKind,
} from "./lawmind-meeting-deliberation";
import { buildMeetingAgendaAsync, sendMeetingChatTurn } from "./lawmind-meeting-chat";
import { abortSessionTurn } from "./lawmind-chat-message-mutate";
import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { formatFileChatContextPill } from "./lawmind-file-chat-context";
import {
  deliberationStateAfterModelError,
  isAbortedMeetingReply,
  MEETING_INTERRUPT_WAIT_MS,
} from "./lawmind-meeting-interrupt";
import { isAdhocMeetingMatterId } from "./lawmind-meeting-scope";
import { LawmindComposeContextPicker } from "./LawmindComposeContextPicker";
import { LAWMID_FS_DRAG_MIME, readLawmindFsDragFromDataTransfer } from "./lawmind-file-drag";

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") {
    return false;
  }
  const name = (e as { name?: unknown }).name;
  return name === "AbortError";
}

type MeetingTurnOut = {
  sessions: Record<string, string | undefined>;
  needsLawyer: boolean;
  aborted: boolean;
};
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
  const [materialsDragOver, setMaterialsDragOver] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterHint, setRosterHint] = useState<string | null>(null);

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
  const turnAbortRef = useRef<AbortController | null>(null);
  const speakingSessionIdRef = useRef<string | undefined>(undefined);
  const interruptWaitersRef = useRef<Array<() => void>>([]);
  const sessionsRef = useRef(sessionByAssistant);
  sessionsRef.current = sessionByAssistant;

  const notifyInterruptWaiters = () => {
    const waiters = interruptWaitersRef.current;
    interruptWaitersRef.current = [];
    for (const w of waiters) {
      w();
    }
  };

  useEffect(() => {
    let cancelled = false;
    setSessionByAssistant(readMeetingSessionMap(matterId));
    setRosterHint(null);
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
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    speakingSessionIdRef.current = undefined;
    for (const w of interruptWaitersRef.current) {
      w();
    }
    interruptWaitersRef.current = [];
    runGenRef.current += 1;

    const applyParticipants = (ids: string[], synthesizer?: string) => {
      if (cancelled) {
        return;
      }
      const next = ids.length > 0 ? ids : [shellAssistantId];
      setParticipantIds(next);
      const synth =
        synthesizer && next.includes(synthesizer)
          ? synthesizer
          : next.includes(shellAssistantId)
            ? shellAssistantId
            : next[0];
      setSynthesizerId(synth);
    };

    void (async () => {
      if (!apiBase?.trim() || isAdhocMeetingMatterId(matterId)) {
        const stored = readParticipants(matterId);
        applyParticipants(stored?.length ? stored : [shellAssistantId]);
        return;
      }
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          roster?: {
            participantAssistantIds?: string[];
            synthesizerAssistantId?: string;
          } | null;
        }>(apiBase, `/api/matters/team-roster?matterId=${encodeURIComponent(matterId)}`);
        if (cancelled) {
          return;
        }
        const rosterIds = j.roster?.participantAssistantIds?.filter(Boolean) ?? [];
        if (rosterIds.length > 0) {
          applyParticipants(rosterIds, j.roster?.synthesizerAssistantId);
          return;
        }
      } catch {
        /* fall through to sessionStorage */
      }
      const stored = readParticipants(matterId);
      applyParticipants(stored?.length ? stored : [shellAssistantId]);
    })();

    return () => {
      cancelled = true;
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      speakingSessionIdRef.current = undefined;
      for (const w of interruptWaitersRef.current) {
        w();
      }
      interruptWaitersRef.current = [];
    };
  }, [apiBase, matterId, shellAssistantId]);

  const rememberRoster = async () => {
    if (!apiBase?.trim() || isAdhocMeetingMatterId(matterId)) {
      setRosterHint("临时讨论不保存本案编制");
      return;
    }
    setRosterBusy(true);
    setRosterHint(null);
    try {
      await apiSendJson(apiBase, "/api/matters/team-roster", "PUT", {
        matterId,
        participantAssistantIds: participantIds,
        synthesizerAssistantId: synthesizerId,
      });
      setRosterHint("已记住本案编制");
    } catch (e) {
      setRosterHint(errorMessage(e, "保存编制失败"));
    } finally {
      setRosterBusy(false);
    }
  };

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
    ): Promise<MeetingTurnOut> => {
      const controller = new AbortController();
      turnAbortRef.current?.abort();
      turnAbortRef.current = controller;
      speakingSessionIdRef.current = sessions[assistantId];
      const meetingAgenda = await buildMeetingAgendaAsync({
        apiBase,
        topic,
        filePins: agendaFilePins,
        signal: controller.signal,
      });
      const turnArgs = (sess: Record<string, string | undefined>) => ({
        apiBase,
        message: text,
        matterId,
        assistantId,
        sessionId: sess[assistantId],
        allowWebSearch: false as const,
        projectDir: projectDir ?? undefined,
        meetingAgenda,
        meetingTurnKind: turnKind,
        signal: controller.signal,
      });
      const toOut = (
        result: Awaited<ReturnType<typeof sendMeetingChatTurn>>,
        nextSessions: Record<string, string | undefined>,
      ): MeetingTurnOut => {
        const msg = result.assistantMessage;
        const needsLawyer =
          (msg.clarificationQuestions?.length ?? 0) > 0 || msg.status === "awaiting_clarification";
        return {
          sessions: nextSessions,
          needsLawyer,
          aborted: controller.signal.aborted || isAbortedMeetingReply(msg.text),
        };
      };
      let result: Awaited<ReturnType<typeof sendMeetingChatTurn>>;
      try {
        result = await sendMeetingChatTurn(turnArgs(sessions));
      } catch (e) {
        if (isAbortError(e) || controller.signal.aborted) {
          throw e;
        }
        if (e instanceof ApiRequestError && e.body?.code === "session_assistant_mismatch") {
          const cleared = { ...sessions, [assistantId]: undefined };
          persistSessions(cleared);
          speakingSessionIdRef.current = undefined;
          result = await sendMeetingChatTurn(turnArgs(cleared));
          const next = applyTurnResult(result, cleared, assistantId);
          speakingSessionIdRef.current = next[assistantId];
          return toOut(result, next);
        }
        throw e;
      } finally {
        if (turnAbortRef.current === controller) {
          turnAbortRef.current = null;
        }
        speakingSessionIdRef.current = undefined;
      }
      const next = applyTurnResult(result, sessions, assistantId);
      return toOut(result, next);
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
          setStatusLabel("已终止当前发言。可补充意见，或继续讨论。");
          setBusy(false);
          notifyInterruptWaiters();
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
          if (out.aborted || gen !== runGenRef.current || pauseRequestedRef.current) {
            // Mid-turn abort → retry same cue after lawyer speaks; else advance.
            setNextCueIndex(out.aborted ? i : i + 1);
            setPhase("paused");
            setStatusLabel("已终止当前发言。可补充意见，或继续讨论。");
            setBusy(false);
            notifyInterruptWaiters();
            return "paused";
          }
          if (out.needsLawyer) {
            setNextCueIndex(i + 1);
            setPhase("paused");
            setStatusLabel("助手需要补充信息。请先回答，再继续讨论。");
            setBusy(false);
            notifyInterruptWaiters();
            return "paused";
          }
        } catch (e) {
          if (isAbortError(e) || pauseRequestedRef.current || gen !== runGenRef.current) {
            setNextCueIndex(i);
            setPhase("paused");
            setStatusLabel("已终止当前发言。可补充意见后继续讨论。");
            setBusy(false);
            notifyInterruptWaiters();
            return "paused";
          }
          setSendErr(errorMessage(e, "讨论中断"));
          setNextCueIndex(i);
          const afterErr = deliberationStateAfterModelError();
          setPhase(afterErr.phase);
          setStatusLabel(afterErr.statusLabel);
          setBusy(afterErr.busy);
          notifyInterruptWaiters();
          return "error";
        }
      }
      setNextCueIndex(cues.length);
      setPhase("idle");
      setStatusLabel("讨论结束。下方已给出结论与工作计划。");
      setBusy(false);
      notifyInterruptWaiters();
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

  const interruptDeliberation = useCallback((): Promise<void> => {
    if (phase !== "running") {
      return Promise.resolve();
    }
    pauseRequestedRef.current = true;
    setStatusLabel("正在终止当前发言…");
    const sessionId = speakingSessionIdRef.current;
    turnAbortRef.current?.abort();
    if (sessionId) {
      void abortSessionTurn(apiBase, sessionId);
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer = 0;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      timer = window.setTimeout(done, MEETING_INTERRUPT_WAIT_MS);
      interruptWaitersRef.current.push(done);
    });
  }, [apiBase, phase]);

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

  /** Leave deliberation without calling the model (error / abandon path). */
  const endDeliberation = useCallback(() => {
    pauseRequestedRef.current = true;
    runGenRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    speakingSessionIdRef.current = undefined;
    notifyInterruptWaiters();
    setBusy(false);
    setPhase("idle");
    setPlan([]);
    setNextCueIndex(0);
    setPendingClarification(null);
    setStatusLabel("已结束讨论。记录仍保留，可再开一场或仅据现有记录出结论。");
  }, []);

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
    notifyInterruptWaiters();
    setPhase("running");
    setBusy(true);
    setSendErr(null);
    setStatusLabel(`正在汇总结论与工作计划（${synth.displayName}）…`);
    try {
      const out = await sendToAssistantWithClarifyPause(
        `讨论议题：${topicText}\n请基于上述讨论输出共识、分歧、工作计划与需律师拍板事项。`,
        synth.assistantId,
        "conclude",
        sessionsRef.current,
      );
      await refreshTimeline();
      if (out.aborted) {
        setPhase("paused");
        setStatusLabel("已终止汇总。可补充意见后再要结论。");
        return;
      }
      setPhase("idle");
      setPlan([]);
      setNextCueIndex(0);
      setStatusLabel("已输出结论与工作计划。");
    } catch (e) {
      if (isAbortError(e)) {
        setPhase("paused");
        setStatusLabel("已终止汇总。可补充意见后再要结论。");
      } else {
        setSendErr(errorMessage(e, "汇总失败"));
        setPhase("paused");
        setStatusLabel("汇总失败，可重试。");
      }
    } finally {
      setBusy(false);
      notifyInterruptWaiters();
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
    if (!text || participantAssistants.length === 0) {
      return;
    }
    if (phase === "running") {
      await interruptDeliberation();
    } else if (busy) {
      return;
    }
    // 律师介入：发给下一位将发言的助手（或首位），时间线记「您」
    const target =
      plan[nextCueIndex]?.assistantId ??
      participantAssistants[0].assistantId;
    setBusy(true);
    setSendErr(null);
    setPhase("paused");
    try {
      const out = await sendToAssistantWithClarifyPause(text, target, "lawyer", sessionsRef.current);
      await refreshTimeline();
      setInput("");
      if (out.needsLawyer) {
        setStatusLabel("还需补充信息后再继续。");
      } else if (plan.length > 0 && nextCueIndex < plan.length) {
        setStatusLabel("已记录您的意见。可继续讨论，或直接要结论。");
      } else {
        setStatusLabel("已记录您的意见。");
      }
    } catch (e) {
      if (!isAbortError(e)) {
        setSendErr(errorMessage(e, "发送失败"));
      }
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    input,
    interruptDeliberation,
    nextCueIndex,
    participantAssistants,
    phase,
    plan,
    refreshTimeline,
    sendToAssistantWithClarifyPause,
  ]);

  const hasEarlier =
    totalLines !== null ? totalLines > lines.length : lines.length >= TIMELINE_PAGE_LIMIT;

  const hasStartTopic = topic.trim().length > 0 || agendaFilePins.length > 0;
  const canStart =
    !busy && phase !== "running" && hasStartTopic && participantAssistants.length >= 2;
  /** Allow typing while assistants speak; send interrupts then delivers. */
  const composeEnabled = phase === "running" || !busy;
  const deliberationActive = phase === "running" || (phase === "paused" && plan.length > 0);
  const startBlockedHint = (() => {
    if (canStart || phase === "running") {
      return null;
    }
    if (participantAssistants.length < 2) {
      return "请至少选择两位助手";
    }
    if (!hasStartTopic) {
      return "请先填写讨论议题，或从左栏拖入议题材料";
    }
    if (busy) {
      return "处理中…";
    }
    return null;
  })();

  const runActions = (
    <div className="lm-matter-meeting-run-actions">
      {phase === "idle" || (phase === "paused" && plan.length === 0) ? (
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
      {phase === "paused" && plan.length > 0 ? (
        <>
          {nextCueIndex < plan.length ? (
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
      {phase === "idle" && lines.length > 0 ? (
        <button
          type="button"
          className="lm-btn lm-btn-ghost"
          disabled={busy || participantAssistants.length === 0}
          onClick={() => void concludeNow().catch(() => undefined)}
        >
          仅根据现有记录出结论
        </button>
      ) : null}
    </div>
  );

  return (
    <div className={`lm-matter-meeting${deliberationActive ? " lm-matter-meeting--live" : ""}`}>
      {deliberationActive ? (
        <div className="lm-matter-meeting-runbar" data-testid="lm-meeting-runbar">
          {statusLabel ? (
            <div className="lm-matter-meeting-status" role="status" aria-live="polite">
              {statusLabel}
            </div>
          ) : null}
          <div className="lm-matter-meeting-cta lm-matter-meeting-cta--runbar">{runActions}</div>
        </div>
      ) : null}

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
          {!isAdhocMeetingMatterId(matterId) ? (
            <div className="lm-matter-meeting-roster-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-meeting-remember-roster"
                disabled={busy || rosterBusy || phase === "running" || participantIds.length === 0}
                onClick={() => void rememberRoster()}
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
              onChange={(e) => setTopic(e.target.value)}
              placeholder="本案和解空间、证据缺口与下一步…"
              disabled={phase === "running" || busy}
            />
          </label>
        </div>

        <div
          className={`lm-matter-meeting-section lm-matter-meeting-materials${materialsDragOver ? " lm-matter-meeting-materials--drop" : ""}`}
          data-testid="lm-meeting-agenda-pins"
          onDragEnter={(e) => {
            if (!onAddAgendaFile) {
              return;
            }
            if ([...e.dataTransfer.types].includes(LAWMID_FS_DRAG_MIME)) {
              e.preventDefault();
              setMaterialsDragOver(true);
            }
          }}
          onDragOver={(e) => {
            if (!onAddAgendaFile) {
              return;
            }
            if ([...e.dataTransfer.types].includes(LAWMID_FS_DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setMaterialsDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
              return;
            }
            setMaterialsDragOver(false);
          }}
          onDrop={(e) => {
            setMaterialsDragOver(false);
            if (!onAddAgendaFile) {
              return;
            }
            const payload = readLawmindFsDragFromDataTransfer(e.dataTransfer);
            if (!payload) {
              return;
            }
            e.preventDefault();
            onAddAgendaFile(payload);
          }}
        >
          <div className="lm-matter-meeting-section-head">
            <h3 className="lm-matter-meeting-section-title">议题材料</h3>
            <div className="lm-matter-meeting-materials-actions">
              {onAddAgendaFile ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  data-testid="lm-meeting-add-materials"
                  onClick={() => {
                    setMaterialsPickerQuery("");
                    setMaterialsPickerOpen(true);
                  }}
                >
                  搜索
                </button>
              ) : null}
            </div>
          </div>
          {agendaFilePins.length > 0 ? (
            <ul className="lm-meeting-materials-list">
              {agendaFilePins.map((pin) => {
                const pill = formatFileChatContextPill(pin);
                return (
                  <li key={pin.id} className="lm-meeting-materials-chip">
                    <span title={pill.title}>{pill.shortLabel}</span>
                    {onRemoveAgendaFile ? (
                      <button
                        type="button"
                        className="lm-meeting-materials-chip-remove"
                        aria-label={`移除 ${pill.title}`}
                        onClick={() => onRemoveAgendaFile(pin.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="lm-meeting-file-hint">
              {materialsDragOver
                ? "松开以加入议题"
                : "从左侧材料树拖入，或点「搜索」；讨论中也可追加"}
            </p>
          )}
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

        <div className="lm-matter-meeting-section lm-matter-meeting-options">
          <div className="lm-matter-meeting-options-grid">
            <label className="lm-matter-meeting-field">
              <span className="lm-matter-meeting-label">轮次</span>
              <select
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
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
          </div>
          <div className="lm-matter-meeting-segment" role="radiogroup" aria-label="律师介入">
            <button
              type="button"
              className={`lm-matter-meeting-segment-btn${lawyerMode === "later" ? " is-on" : ""}`}
              aria-checked={lawyerMode === "later"}
              role="radio"
              disabled={phase === "running"}
              onClick={() => setLawyerMode("later")}
            >
              先讨论
            </button>
            <button
              type="button"
              className={`lm-matter-meeting-segment-btn${lawyerMode === "open" ? " is-on" : ""}`}
              aria-checked={lawyerMode === "open"}
              role="radio"
              disabled={phase === "running"}
              onClick={() => setLawyerMode("open")}
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

      <section className="lm-matter-meeting-thread" aria-label="讨论记录">
        <div className="lm-matter-meeting-thread-head">
          <h3 className="lm-matter-meeting-section-title">讨论记录</h3>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => void refreshTimeline()}
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
              onClick={() => void loadEarlier()}
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

        <div className="lm-matter-meeting-compose">
          <textarea
            className="lm-matter-meeting-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
                data-testid="lm-meeting-send-intervene"
                disabled={busy || !input.trim()}
                onClick={() => void sendLawyerIntervene().catch(() => undefined)}
              >
                {busy ? "发送中…" : "发送意见"}
              </button>
            ) : null}
            {phase === "running" && input.trim() ? (
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                data-testid="lm-meeting-send-intervene"
                onClick={() => void sendLawyerIntervene().catch(() => undefined)}
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
    </div>
  );
}
