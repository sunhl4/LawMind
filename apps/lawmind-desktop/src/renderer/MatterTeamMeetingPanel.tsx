import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TeamMeetingLine } from "../../../../src/lawmind/cases/index.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import type { FileChatContextItem } from "./lawmind-file-chat-context";
import { isAdhocMeetingMatterId } from "./lawmind-meeting-scope";
import {
  readMeetingParticipants as readParticipants,
  writeMeetingParticipants as writeParticipants,
} from "./lawmind-meeting-session-storage";
import {
  MatterTeamMeetingRunActions,
  MatterTeamMeetingSetupSection,
} from "./MatterTeamMeetingSetupSection";
import { MatterTeamMeetingThreadSection } from "./MatterTeamMeetingThreadSection";
import {
  useMatterTeamMeetingDeliberation,
  type MeetingAssistantRow,
} from "./useMatterTeamMeetingDeliberation";

const TIMELINE_PAGE_LIMIT = 120;

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

  const [assistants, setAssistants] = useState<MeetingAssistantRow[]>([]);
  const [participantIds, setParticipantIds] = useState<string[]>(() => {
    const stored = readParticipants(matterId);
    return stored?.length ? stored : [shellAssistantId];
  });
  const [lines, setLines] = useState<TeamMeetingLine[]>([]);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [synthesizerId, setSynthesizerId] = useState(shellAssistantId);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterHint, setRosterHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRosterHint(null);
    setLoadErr(null);
    setTotalLines(null);

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
      const j = await apiGetJson<{ ok?: boolean; assistants?: MeetingAssistantRow[] }>(
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

  const deliberation = useMatterTeamMeetingDeliberation({
    apiBase,
    matterId,
    projectDir,
    agendaFilePins,
    participantAssistants,
    synthesizerId,
    refreshTimeline,
  });

  const hasEarlier =
    totalLines !== null ? totalLines > lines.length : lines.length >= TIMELINE_PAGE_LIMIT;

  const runActions = (
    <MatterTeamMeetingRunActions
      phase={deliberation.phase}
      planLength={deliberation.plan.length}
      nextCueIndex={deliberation.nextCueIndex}
      canStart={deliberation.canStart}
      busy={deliberation.busy}
      participantCount={participantAssistants.length}
      linesCount={lines.length}
      startDeliberation={deliberation.startDeliberation}
      interruptDeliberation={deliberation.interruptDeliberation}
      resumeDeliberation={deliberation.resumeDeliberation}
      concludeNow={deliberation.concludeNow}
      endDeliberation={deliberation.endDeliberation}
    />
  );

  return (
    <div
      className={`lm-matter-meeting${deliberation.deliberationActive ? " lm-matter-meeting--live" : ""}`}
    >
      {deliberation.deliberationActive ? (
        <div className="lm-matter-meeting-runbar" data-testid="lm-meeting-runbar">
          {deliberation.statusLabel ? (
            <div className="lm-matter-meeting-status" role="status" aria-live="polite">
              {deliberation.statusLabel}
            </div>
          ) : null}
          <div className="lm-matter-meeting-cta lm-matter-meeting-cta--runbar">{runActions}</div>
        </div>
      ) : null}

      <MatterTeamMeetingSetupSection
        matterId={matterId}
        apiBase={apiBase}
        assistants={assistants}
        participantIds={participantIds}
        participantAssistants={participantAssistants}
        agendaFilePins={agendaFilePins}
        onAddAgendaFile={onAddAgendaFile}
        onRemoveAgendaFile={onRemoveAgendaFile}
        busy={deliberation.busy}
        phase={deliberation.phase}
        deliberationActive={deliberation.deliberationActive}
        statusLabel={deliberation.statusLabel}
        topic={deliberation.topic}
        onTopicChange={deliberation.setTopic}
        rounds={deliberation.rounds}
        onRoundsChange={deliberation.setRounds}
        synthesizerId={synthesizerId}
        onSynthesizerChange={setSynthesizerId}
        lawyerMode={deliberation.lawyerMode}
        onLawyerModeChange={deliberation.setLawyerMode}
        allowMeetingWebSearch={deliberation.allowMeetingWebSearch}
        onAllowMeetingWebSearchChange={deliberation.setAllowMeetingWebSearch}
        rosterBusy={rosterBusy}
        rosterHint={rosterHint}
        onRememberRoster={() => void rememberRoster()}
        toggleParticipant={toggleParticipant}
        startBlockedHint={deliberation.startBlockedHint}
        runActions={runActions}
      />

      <MatterTeamMeetingThreadSection
        lines={lines}
        loadErr={loadErr}
        sendErr={deliberation.sendErr}
        hasEarlier={hasEarlier}
        loadingEarlier={loadingEarlier}
        busy={deliberation.busy}
        phase={deliberation.phase}
        lawyerMode={deliberation.lawyerMode}
        composeEnabled={deliberation.composeEnabled}
        input={deliberation.input}
        onInputChange={deliberation.setInput}
        onRefreshTimeline={() => void refreshTimeline()}
        onLoadEarlier={() => void loadEarlier()}
        pendingClarification={deliberation.pendingClarification}
        onApplyClarificationToInput={(t) =>
          deliberation.setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${t}` : t))
        }
        onSendClarificationReply={(payload) => void deliberation.sendClarificationReply(payload)}
        onSendLawyerIntervene={deliberation.sendLawyerIntervene}
      />
    </div>
  );
}
