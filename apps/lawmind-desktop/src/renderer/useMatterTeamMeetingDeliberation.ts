/**
 * 会议室：讨论编排（开始 / 中断 / 继续 / 汇总 / 律师介入）从 MatterTeamMeetingPanel 抽出。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { ApiRequestError, errorMessage } from "./api-client";
import { abortSessionTurn } from "./lawmind-chat-message-mutate";
import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { buildMeetingAgendaAsync, sendMeetingChatTurn } from "./lawmind-meeting-chat";
import {
  buildDeliberationPlan,
  formatDeliberationStatus,
  type DeliberationCue,
  type MeetingTurnKind,
} from "./lawmind-meeting-deliberation";
import {
  deliberationStateAfterModelError,
  isAbortedMeetingReply,
  MEETING_INTERRUPT_WAIT_MS,
} from "./lawmind-meeting-interrupt";
import {
  readMeetingSessionMap,
  writeMeetingSessionMap,
} from "./lawmind-meeting-session-storage";

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

export type MeetingAssistantRow = { assistantId: string; displayName: string };

export type LawyerMode = "open" | "later";
export type MeetingPhase = "idle" | "running" | "paused";

export type UseMatterTeamMeetingDeliberationParams = {
  apiBase: string;
  matterId: string;
  projectDir?: string | null;
  agendaFilePins: FileChatContextItem[];
  participantAssistants: MeetingAssistantRow[];
  synthesizerId: string;
  refreshTimeline: () => Promise<void>;
};

export function useMatterTeamMeetingDeliberation(params: UseMatterTeamMeetingDeliberationParams) {
  const {
    apiBase,
    matterId,
    projectDir,
    agendaFilePins,
    participantAssistants,
    synthesizerId,
    refreshTimeline,
  } = params;

  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [topic, setTopic] = useState("");
  const [rounds, setRounds] = useState(2);
  const [lawyerMode, setLawyerMode] = useState<LawyerMode>("later");
  const [phase, setPhase] = useState<MeetingPhase>("idle");
  const [allowMeetingWebSearch, setAllowMeetingWebSearch] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeliberationCue[]>([]);
  const [nextCueIndex, setNextCueIndex] = useState(0);
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
    setSessionByAssistant(readMeetingSessionMap(matterId));
    setSendErr(null);
    setTopic("");
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

    return () => {
      turnAbortRef.current?.abort();
      turnAbortRef.current = null;
      speakingSessionIdRef.current = undefined;
      for (const w of interruptWaitersRef.current) {
        w();
      }
      interruptWaitersRef.current = [];
    };
  }, [matterId]);

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
        allowWebSearch: allowMeetingWebSearch,
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
    [
      agendaFilePins,
      allowMeetingWebSearch,
      apiBase,
      applyTurnResult,
      matterId,
      persistSessions,
      projectDir,
      topic,
    ],
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
    const target = plan[nextCueIndex]?.assistantId ?? participantAssistants[0].assistantId;
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

  const sendClarificationReply = useCallback(
    async (payload: string) => {
      setBusy(true);
      setSendErr(null);
      try {
        const target =
          plan[Math.max(0, nextCueIndex - 1)]?.assistantId ?? participantAssistants[0]?.assistantId;
        if (!target) {
          return;
        }
        await sendToAssistantWithClarifyPause(payload, target, "lawyer", sessionsRef.current);
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
    },
    [
      nextCueIndex,
      participantAssistants,
      plan,
      refreshTimeline,
      sendToAssistantWithClarifyPause,
    ],
  );

  const hasStartTopic = topic.trim().length > 0 || agendaFilePins.length > 0;
  const canStart = !busy && phase !== "running" && hasStartTopic && participantAssistants.length >= 2;
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

  return {
    busy,
    sendErr,
    input,
    setInput,
    topic,
    setTopic,
    rounds,
    setRounds,
    lawyerMode,
    setLawyerMode,
    phase,
    allowMeetingWebSearch,
    setAllowMeetingWebSearch,
    statusLabel,
    plan,
    nextCueIndex,
    pendingClarification,
    hasStartTopic,
    canStart,
    composeEnabled,
    deliberationActive,
    startBlockedHint,
    startDeliberation,
    interruptDeliberation,
    resumeDeliberation,
    endDeliberation,
    concludeNow,
    sendLawyerIntervene,
    sendClarificationReply,
  };
}
