/**
 * Pull visible assistant text from an OpenAI-compatible chat completion.
 * Reasoning models (DeepSeek / Qwen) often put JSON in `reasoning_content`
 * and leave `content` empty — Codex/Cursor-style callers must not invent a
 * small max_tokens cap to "force" JSON into content.
 */

export type AssistantTextView = {
  text: string;
  finishReason?: string;
};

export function extractAssistantText(response: {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
}): AssistantTextView {
  const choice = response.choices?.[0];
  const msg = choice?.message;
  const content = String(msg?.content ?? "").trim();
  const reasoning = String(msg?.reasoning_content ?? "").trim();
  const finishReason =
    typeof choice?.finish_reason === "string" && choice.finish_reason.trim()
      ? choice.finish_reason.trim()
      : undefined;
  return {
    text: content || reasoning,
    ...(finishReason ? { finishReason } : {}),
  };
}

/** DeepSeek harness `stopReason: length` — truncated output is empty/unreadable, not a coverage miss. */
export function assistantOutputLooksTruncated(view: AssistantTextView): boolean {
  const reason = view.finishReason?.toLowerCase();
  return reason === "length" || reason === "max_tokens";
}

/**
 * Sidecar JSON (Guardian / router / critic): resample empty or length-truncated
 * draws on the same attempt budget as transport (DeepSeek EMPTY_RESPONSE + TRANSPORT).
 */
export function shouldResampleSidecarJson(opts: {
  parsed: boolean;
  truncated: boolean;
  attempt: number;
  attempts: number;
}): boolean {
  if (opts.attempts <= 0 || opts.attempt + 1 >= opts.attempts) {
    return false;
  }
  return !opts.parsed || opts.truncated;
}
