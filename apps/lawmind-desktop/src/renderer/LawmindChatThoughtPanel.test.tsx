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
});
