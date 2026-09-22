/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindChatThoughtPanel } from "./LawmindChatThoughtPanel";
import { subscribeOpenChatSession } from "./lawmind-open-chat-session-bus";

describe("LawmindChatThoughtPanel session chips", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("lets the lawyer open a hit from the thought chips", async () => {
    const opened: string[] = [];
    const stop = subscribeOpenChatSession((ref) => {
      opened.push(ref.sessionId);
    });
    await act(async () => {
      root.render(
        <LawmindChatThoughtPanel
          tools={[
            {
              id: "tc1",
              kind: "tool",
              toolCallId: "tc1",
              toolName: "search_conversations",
              label: "检索其他对话",
              status: "done",
              progress: [],
              sessionRefs: [{ sessionId: "sess-1", title: "采购合同审查" }],
            },
          ]}
          reasoningMarkdown=""
          renderMarkdown={() => null}
        />,
      );
    });
    const chip = host.querySelector('[data-testid="lm-chat-session-chip-sess-1"]');
    expect(chip).toBeTruthy();
    await act(async () => {
      (chip as HTMLButtonElement).click();
    });
    stop();
    expect(opened).toEqual(["sess-1"]);
  });

  it("does not dump tool chips into the thread when collapsed", async () => {
    await act(async () => {
      root.render(
        <LawmindChatThoughtPanel
          tools={[
            {
              id: "tc1",
              kind: "tool",
              toolCallId: "tc1",
              toolName: "list_dir",
              label: "列举目录",
              status: "done",
              progress: [],
            },
            {
              id: "tc2",
              kind: "tool",
              toolCallId: "tc2",
              toolName: "analyze_document",
              label: "分析文书",
              status: "failed",
              progress: [],
            },
            {
              id: "tc3",
              kind: "tool",
              toolCallId: "tc3",
              toolName: "search_matter",
              label: "检索案卷材料",
              status: "done",
              progress: [],
            },
          ]}
          reasoningMarkdown=""
          renderMarkdown={() => null}
        />,
      );
    });
    expect(host.querySelector(".lm-chat-thought-chips")).toBeNull();
    expect(host.textContent).toContain("已完成");
    expect(host.textContent).toContain("等 3 步");
    expect(host.querySelector(".lm-chat-thought-steps")).toBeNull();
  });
});
