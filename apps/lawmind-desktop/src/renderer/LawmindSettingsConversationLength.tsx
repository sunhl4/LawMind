/**
 * 对话窗口三档，放在输入栏模型旁边：200K / 500K / 1M。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CONVERSATION_LENGTH_PRESETS,
  conversationLengthPreset,
  DEFAULT_CONVERSATION_LENGTH,
  resolveConversationLength,
  type ConversationLengthId,
} from "../../../../src/lawmind/agent/context-preset.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type Props = {
  apiBase?: string;
  /** 当前模型目录里的窗口。比所选档短时，说明会按模型自己的能力来。 */
  modelContextTokens?: number;
  disabled?: boolean;
  /** 附在说明后，例如回复还在输出时：本轮窗口不变。 */
  pendingHint?: string;
};

export function LawmindSettingsConversationLength(props: Props): ReactNode {
  const { apiBase, modelContextTokens, disabled = false, pendingHint } = props;
  const [length, setLength] = useState<ConversationLengthId>(DEFAULT_CONVERSATION_LENGTH);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ conversationLength?: string }>(apiBase, "/api/policy/workspace")
      .then((body) => {
        if (!cancelled) {
          setLength(resolveConversationLength(body.conversationLength));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLength(DEFAULT_CONVERSATION_LENGTH);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const onPick = useCallback(
    (next: ConversationLengthId) => {
      if (!apiBase || next === length || busy || disabled) {
        return;
      }
      setBusy(true);
      setNote(null);
      void apiSendJson(apiBase, "/api/policy/workspace", "PATCH", { conversationLength: next })
        .then(() => {
          setLength(next);
        })
        .catch((cause: unknown) => {
          setNote(errorMessage(cause, "没能切换上下文长度"));
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [apiBase, busy, disabled, length],
  );

  const preset = conversationLengthPreset(length);
  const modelShorter =
    typeof modelContextTokens === "number" &&
    modelContextTokens > 0 &&
    modelContextTokens < preset.contextTokens;
  const title = [
    modelShorter
      ? `${preset.detail} 当前模型比这一档短，会按它自己的能力记住。`
      : preset.detail,
    pendingHint,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className="lm-compose-context-length" data-testid="lm-compose-context-length">
      <select
        className="lm-compose-context-length-select"
        aria-label="上下文长度"
        title={title}
        value={length}
        disabled={!apiBase || busy || disabled}
        data-testid="lm-compose-context-length-select"
        onChange={(event) => onPick(event.target.value as ConversationLengthId)}
      >
        {CONVERSATION_LENGTH_PRESETS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
            {item.id === DEFAULT_CONVERSATION_LENGTH ? "（默认）" : ""}
          </option>
        ))}
      </select>
      {note ? (
        <span className="lm-meta" role="status">
          {note}
        </span>
      ) : null}
    </label>
  );
}
