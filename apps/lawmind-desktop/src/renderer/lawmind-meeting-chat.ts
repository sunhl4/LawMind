import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import {
  ApiRequestError,
  chatErrorUserText,
  readJsonFromResponse,
  type ApiErrorJson,
} from "./api-client";
import {
  parseRuntimeHintsFromResponse,
  type ChatMsg,
  type ChatRuntimeHints,
} from "./lawmind-chat";

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
}): Promise<{
  sessionId?: string;
  assistantMessage: ChatMsg;
}> {
  const response = await fetch(`${args.apiBase}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: args.message,
      sessionId: args.sessionId,
      assistantId: args.assistantId,
      matterId: args.matterId,
      meetingMode: true,
      allowWebSearch: args.allowWebSearch === true,
      ...(args.projectDir ? { projectDir: args.projectDir } : {}),
      ...(args.meetingAgenda?.trim() ? { meetingAgenda: args.meetingAgenda.trim() } : {}),
    }),
  });
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
