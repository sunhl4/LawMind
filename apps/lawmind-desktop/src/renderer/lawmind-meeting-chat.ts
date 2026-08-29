import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import {
  ApiRequestError,
  chatErrorUserText,
  fetchWithLoopbackAuthRetry,
  readJsonFromResponse,
  type ApiErrorJson,
} from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import {
  parseRuntimeHintsFromResponse,
  type ChatMsg,
  type ChatRuntimeHints,
} from "./lawmind-chat";
import {
  buildFileContextMessagePrefix,
  fetchFileChatExcerpts,
  type FileChatContextItem,
} from "./lawmind-file-chat-context";

const MAX_MEETING_AGENDA_FILE_PINS = 8;

/**
 * Merge lawyer topic + file pins into `meetingAgenda` (model context only; not JSONL user text).
 * Prefer `buildMeetingAgendaAsync` when apiBase is available so small files get embedded.
 */
export function buildMeetingAgenda(opts: {
  topic?: string;
  filePins?: FileChatContextItem[];
  excerpts?: Record<string, string>;
}): string | undefined {
  const topic = (opts.topic ?? "").trim();
  const pins = (opts.filePins ?? []).slice(0, MAX_MEETING_AGENDA_FILE_PINS);
  const filePrefix = buildFileContextMessagePrefix(pins, opts.excerpts).trim();
  const joined = [topic, filePrefix].filter(Boolean).join("\n\n");
  return joined || undefined;
}

/** Async agenda builder: embeds small text pins via `/api/fs/read`. */
export async function buildMeetingAgendaAsync(opts: {
  apiBase: string;
  topic?: string;
  filePins?: FileChatContextItem[];
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const pins = (opts.filePins ?? []).slice(0, MAX_MEETING_AGENDA_FILE_PINS);
  const excerpts =
    pins.length > 0
      ? await fetchFileChatExcerpts({
          apiBase: opts.apiBase,
          items: pins,
          signal: opts.signal,
        })
      : {};
  return buildMeetingAgenda({
    topic: opts.topic,
    filePins: pins,
    excerpts,
  });
}

/** Short timeline label for pinned materials (system line). */
export function formatMeetingMaterialsSystemText(filePins: FileChatContextItem[]): string {
  const pins = filePins.slice(0, MAX_MEETING_AGENDA_FILE_PINS);
  if (pins.length === 0) {
    return "";
  }
  const paths = pins.map((p) => {
    const scope = p.root === "workspace" ? "工作区" : "项目";
    return `${scope}:${p.relPath || "（根）"}`;
  });
  return `材料（本回合重点）：${paths.join("；")}`;
}

type MeetingChatResponse = {
  ok?: boolean;
  sessionId?: string;
  reply?: string;
  status?: string;
  clarificationQuestions?: ClarificationQuestion[];
  memorySources?: MemorySourceLayer[];
  toolCallSequence?: string[];
  runtimeHints?: unknown;
};

export async function sendMeetingChatTurn(args: {
  apiBase: string;
  message: string;
  matterId: string;
  assistantId: string;
  sessionId?: string;
  allowWebSearch?: boolean;
  projectDir?: string | null;
  /** 注入模型上下文，不写入 team-meeting.jsonl */
  meetingAgenda?: string;
  /** lawyer=律师发言；chair/conclude=主持人催办（时间线不记「您」） */
  meetingTurnKind?: "lawyer" | "chair" | "conclude";
  /** Client abort (paired with POST /api/sessions/:id/abort). */
  signal?: AbortSignal;
}): Promise<{
  sessionId?: string;
  assistantMessage: ChatMsg;
}> {
  const meetingTurnKind = args.meetingTurnKind ?? "lawyer";
  const { response } = await fetchWithLoopbackAuthRetry(args.apiBase, (base) =>
    fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...apiAuthHeaders() },
      signal: args.signal,
      body: JSON.stringify({
        message: args.message,
        sessionId: args.sessionId,
        assistantId: args.assistantId,
        matterId: args.matterId,
        meetingMode: true,
        meetingTurnKind,
        allowWebSearch: args.allowWebSearch === true,
        ...(args.projectDir ? { projectDir: args.projectDir } : {}),
        ...(args.meetingAgenda?.trim() ? { meetingAgenda: args.meetingAgenda.trim() } : {}),
      }),
    }),
  );
  const body = await readJsonFromResponse<MeetingChatResponse>(response);
  if (!response.ok || body.ok === false) {
    throw new ApiRequestError(
      response.status,
      chatErrorUserText(response.status, body as ApiErrorJson),
      body as ApiErrorJson,
    );
  }
  const memorySources = Array.isArray(body.memorySources) ? body.memorySources : undefined;
  const clarificationQuestions = Array.isArray(body.clarificationQuestions)
    ? body.clarificationQuestions.filter(
        (item): item is ClarificationQuestion =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { question?: unknown }).question === "string",
      )
    : [];
  const rawSequence = Array.isArray(body.toolCallSequence) ? body.toolCallSequence : [];
  const toolCallSequence = rawSequence.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  const runtimeHints: ChatRuntimeHints | undefined = parseRuntimeHintsFromResponse(body.runtimeHints);
  return {
    sessionId: body.sessionId,
    assistantMessage: {
      role: "assistant",
      text: body.reply || "(empty)",
      ...(typeof body.status === "string" && body.status.trim() ? { status: body.status } : {}),
      ...(clarificationQuestions.length > 0 ? { clarificationQuestions } : {}),
      ...(memorySources && memorySources.length > 0 ? { memorySources } : {}),
      ...(toolCallSequence.length > 0 ? { toolCallSequence } : {}),
      ...(runtimeHints ? { runtimeHints } : {}),
    },
  };
}
