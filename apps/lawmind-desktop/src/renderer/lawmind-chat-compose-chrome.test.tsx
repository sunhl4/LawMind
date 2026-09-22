/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindChatComposeChrome } from "./lawmind-chat-compose-chrome";

describe("LawmindChatComposeChrome", () => {
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

  it("hides the Word revision bar when the fast lane is open", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeChrome
          error={null}
          composeInput="请改合同"
          onComposeInputChange={() => undefined}
          queuedMessages={[]}
          fileChatPills={[{ id: "1", shortLabel: "合同", title: "设备采购合同.docx", relPath: "设备采购合同.docx" }]}
          contextMatterId={null}
          contextTaskId={null}
          matterTitle={null}
          onRemoveFileChatPill={() => undefined}
          onClearFileChatPills={() => undefined}
          hideWordRevisionBar
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-word-revision-bar"]')).toBeNull();
  });
});
