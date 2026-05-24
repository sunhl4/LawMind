import type { ChatActivityBlock, ChatActivityTextBlock, ChatActivityToolBlock } from "./lawmind-chat-activity.js";

export type ThoughtActivityPartition = {
  tools: ChatActivityToolBlock[];
  reasoningMarkdown: string;
  answerText: string;
};

function toolSubtitle(tool: ChatActivityToolBlock): string | undefined {
  const fromProgress = tool.progress.filter(Boolean).join(" · ").trim();
  if (fromProgress) {
    return fromProgress;
  }
  const detail = tool.detail?.trim();
  if (detail && tool.status === "failed") {
    return detail;
  }
  if (tool.status === "running") {
    return "进行中…";
  }
  if (tool.status === "done") {
    return "已完成";
  }
  return undefined;
}

export function thoughtToolSubtitle(tool: ChatActivityToolBlock): string | undefined {
  return toolSubtitle(tool);
}

/** Split activity stream into Cursor-style thought (tools + reasoning) vs final reply. */
export function partitionActivityForThoughtView(
  blocks: ChatActivityBlock[],
  opts?: { finalText?: string; streaming?: boolean },
): ThoughtActivityPartition {
  const tools = blocks.filter((b): b is ChatActivityToolBlock => b.kind === "tool");
  const textBlocks = blocks.filter(
    (b): b is ChatActivityTextBlock => b.kind === "text" && Boolean(b.content.trim()),
  );
  const finalText = opts?.finalText?.trim() ?? "";
  const streaming = Boolean(opts?.streaming);

  if (textBlocks.length === 0) {
    return { tools, reasoningMarkdown: "", answerText: finalText };
  }

  if (streaming) {
    return {
      tools,
      reasoningMarkdown: textBlocks.map((b) => b.content).join("\n\n").trim(),
      answerText: "",
    };
  }

  if (textBlocks.length === 1) {
    const only = textBlocks[0].content.trim();
    if (tools.length > 0) {
      return {
        tools,
        reasoningMarkdown: "",
        answerText: finalText || only,
      };
    }
    return { tools, reasoningMarkdown: "", answerText: finalText || only };
  }

  const reasoningMarkdown = textBlocks
    .slice(0, -1)
    .map((b) => b.content)
    .join("\n\n")
    .trim();
  const lastText = textBlocks[textBlocks.length - 1].content.trim();
  return {
    tools,
    reasoningMarkdown,
    answerText: finalText || lastText,
  };
}

export function formatThoughtDurationLabel(seconds: number, streaming: boolean): string {
  if (streaming) {
    return "思考中…";
  }
  if (seconds < 1) {
    return "Thought briefly";
  }
  return `Thought for ${seconds}s`;
}
