import type { ChatMsg } from "../lawmind-chat";

const CANVAS_PATH = /(?:^|[\s"'`(])((?:[\w.-]+\/)*[\w.-]+\.canvas\.tsx)\b/g;

export function canvasPathsInText(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(CANVAS_PATH)) {
    const path = match[1]?.replace(/\\/g, "/");
    if (!path || path.split("/").includes("..") || path.startsWith("/")) {
      continue;
    }
    if (!out.includes(path)) {
      out.push(path);
    }
  }
  return out;
}

/** Paths mentioned in the latest assistant turn, including tool detail. */
export function canvasPathsFromMessages(messages: readonly ChatMsg[]): string[] {
  const last = messages.toReversed().find((message) => message.role === "assistant");
  if (!last) {
    return [];
  }
  const chunks = [last.text];
  for (const block of last.activity ?? []) {
    if (block.kind === "text") {
      chunks.push(block.content);
    } else {
      chunks.push(block.detail ?? "", block.label, ...block.progress);
    }
  }
  const out: string[] = [];
  for (const chunk of chunks) {
    for (const path of canvasPathsInText(chunk)) {
      if (!out.includes(path)) {
        out.push(path);
      }
    }
  }
  return out;
}
