import type { ReactNode } from "react";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";

type Props = {
  text: string;
  modelFailure?: boolean;
  className?: string;
};

export function LawmindMsgAssistant({ text, modelFailure, className }: Props): ReactNode {
  if (!text.trim()) {
    return null;
  }
  return (
    <div
      className={`lm-msg lm-msg-ai${modelFailure ? " lm-msg-model-failure" : ""}${className ? ` ${className}` : ""}`}
    >
      {renderLegalMarkdown(text)}
    </div>
  );
}
