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

  it("does not ask for document type or stance when a Word file is attached", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeChrome
          error={null}
          composeInput="请改合同"
          queuedMessages={[]}
          fileChatPills={[{ id: "1", shortLabel: "合同", title: "《聘用合同》（劳务合同）.docx", relPath: "聘用合同.docx" }]}
          contextMatterId={null}
          contextTaskId={null}
          matterTitle={null}
          onRemoveFileChatPill={() => undefined}
          onClearFileChatPills={() => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-word-revision-bar"]')).toBeNull();
    expect(host.textContent).not.toContain("股权融资");
    expect(host.textContent).not.toContain("人事用工");
    expect(host.textContent).not.toContain("己方立场");
  });
});
