/**
 * MainBody 深链 handler 工厂（拆自 useLawmindMainBodyContentProps 的 useMemo 主体，
 * 纯提取无行为变化）：review / meeting / chat 三组跳转 handler。
 */
import type { LawmindMainView } from "../lawmind-main-view";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";

export type ReviewDeepLinkDeps = {
  setReviewLaunchedFromMatter: (v: boolean) => void;
  setReviewFocusTaskId: (id: string | null) => void;
  setReviewFocusMatterId: (id: string | null) => void;
  setReviewFocusStatus: (s: ArtifactDraft["reviewStatus"] | "all") => void;
  setReviewFocusListMode: (m: "pending" | "all") => void;
  setContextMatterId: (id: string | null) => void;
  setMainView: (view: LawmindMainView) => void;
  setFocusMatterIdFromReview: (id: string | null) => void;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  reviewFocusMatterId: string | null;
};

export function buildReviewDeepLinkHandlers(deps: ReviewDeepLinkDeps) {
  const {
    setReviewLaunchedFromMatter,
    setReviewFocusTaskId,
    setReviewFocusMatterId,
    setReviewFocusStatus,
    setReviewFocusListMode,
    setContextMatterId,
    setMainView,
    setFocusMatterIdFromReview,
    setMatterCockpitOpen,
    reviewFocusMatterId,
  } = deps;
  return {
    onOpenReviewFromMatter: ({
      taskId,
      matterId,
      statusFilter = "all",
      listMode = "all",
    }: {
      taskId: string;
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
    }) => {
      setReviewLaunchedFromMatter(true);
      setReviewFocusTaskId(taskId);
      setReviewFocusMatterId(matterId ?? null);
      setReviewFocusStatus(statusFilter ?? "all");
      setReviewFocusListMode(listMode ?? "all");
      if (matterId) {
        setContextMatterId(matterId);
      }
      setMainView("review");
    },
    onOpenReviewFromWorkItem: (taskId: string, matterId?: string) => {
      setReviewLaunchedFromMatter(false);
      setReviewFocusTaskId(taskId);
      setReviewFocusMatterId(matterId ?? null);
      setReviewFocusStatus("all");
      setReviewFocusListMode("pending");
      if (matterId) {
        setContextMatterId(matterId);
      }
      setMainView("review");
    },
    onReturnToMatter: () => {
      if (reviewFocusMatterId) {
        setFocusMatterIdFromReview(reviewFocusMatterId);
      }
      setReviewLaunchedFromMatter(false);
      setMainView("workspace");
      setMatterCockpitOpen(true);
    },
  };
}

export type MeetingDeepLinkDeps = {
  setContextMatterId: (id: string | null) => void;
  recordsDeskMattersSetSelectedKey: (key: string) => void;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMainView: (view: LawmindMainView) => void;
};

export function buildMeetingDeepLinkHandlers(deps: MeetingDeepLinkDeps) {
  const {
    setContextMatterId,
    recordsDeskMattersSetSelectedKey,
    setMatterCockpitOpen,
    setMainView,
  } = deps;
  return {
    onOpenTopLevelMeeting: (matterId: string) => {
      const mid = matterId.trim();
      if (mid) {
        setContextMatterId(mid);
        recordsDeskMattersSetSelectedKey(mid);
      }
      setMatterCockpitOpen(false);
      setMainView("meeting");
    },
    onSelectMeetingMatterScope: (matterId: string | null) => {
      const mid = matterId?.trim() || null;
      setContextMatterId(mid);
      if (mid) {
        recordsDeskMattersSetSelectedKey(mid);
      }
    },
  };
}

export type ChatDeepLinkDeps = {
  setContextMatterId: (id: string | null) => void;
  setMatterCockpitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMainView: (view: LawmindMainView) => void;
  setContextTaskId: (id: string | null) => void;
  selectChatSession: (sessionId: string, assistantId?: string) => Promise<void> | void;
  scheduleScrollChatMessagesToLatest: (opts?: { behavior?: ScrollBehavior }) => void;
  setInput: (value: string) => void;
  focusComposer: () => void;
};

export function buildChatDeepLinkHandlers(deps: ChatDeepLinkDeps) {
  const {
    setContextMatterId,
    setMatterCockpitOpen,
    setMainView,
    setContextTaskId,
    selectChatSession,
    scheduleScrollChatMessagesToLatest,
    setInput,
    focusComposer,
  } = deps;
  return {
    onOpenChatSession: (sessionId: string, matterId?: string, assistantId?: string) => {
      if (matterId?.trim()) {
        setContextMatterId(matterId.trim());
      }
      setMatterCockpitOpen(false);
      setMainView("workspace");
      void Promise.resolve(selectChatSession(sessionId, assistantId)).finally(() => {
        // Session load is async; land on latest execution, not the turn start.
        scheduleScrollChatMessagesToLatest({ behavior: "smooth" });
      });
    },
    onGoToChat: ({
      taskId,
      matterId,
      prompt,
    }: {
      taskId: string;
      matterId?: string;
      prompt?: string;
    }) => {
      setContextTaskId(taskId);
      if (matterId?.trim()) {
        setContextMatterId(matterId.trim());
      }
      setMainView("workspace");
      if (prompt?.trim()) {
        setInput(prompt.trim());
        focusComposer();
      }
    },
  };
}
