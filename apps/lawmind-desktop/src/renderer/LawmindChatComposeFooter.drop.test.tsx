/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatComposeFooter } from "./lawmind-chat-shell";
import { encodeLawmindFsDrag, LAWMID_FS_DRAG_MIME } from "./lawmind-file-drag";
import { mockComposeExtras } from "./test/mock-compose-extras";

function footerProps(overrides: Partial<React.ComponentProps<typeof LawmindChatComposeFooter>> = {}) {
  return {
    currentMessages: [],
    input: "",
    loading: false,
    error: null,
    contextTaskId: null,
    contextMatterId: null,
    matterTitle: null,
    textareaRef: { current: null },
    onInputChange: () => {},
    onSend: () => {},
    onAbortChat: () => {},
    onApplyPrompt: () => {},
    onClearContext: () => {},
    onOpenComposeSettings: vi.fn(),
    onOpenApiWizard: vi.fn(),
    composeModelHint: null,
    composeModelQuickTestBusy: false,
    onComposeModelQuickTest: vi.fn(),
    composeModelConfigured: true,
    modelCatalog: [],
    selectedModelId: "m1",
    onModelSelect: vi.fn(),
    onDelegateAssist: vi.fn(),
    allowWebSearch: false,
    onAllowWebSearchChange: () => {},
    apiBase: "http://127.0.0.1:1",
    chatSessionId: "s1",
    fileChatPills: [],
    onRemoveFileChatPill: () => {},
    onClearFileChatPills: () => {},
    composeExtras: mockComposeExtras(),
    workspaceDir: "/tmp/ws",
    projectDir: null,
    ...overrides,
  } satisfies React.ComponentProps<typeof LawmindChatComposeFooter>;
}

describe("LawmindChatComposeFooter file drop", () => {
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

  it("pins a file-tree drop onto the compose zone", async () => {
    const onAdd = vi.fn();
    await act(async () => {
      root.render(<LawmindChatComposeFooter {...footerProps({ onAddFileToChatContext: onAdd })} />);
    });
    const zone = host.querySelector('[data-testid="lm-compose-drop-zone"]') as HTMLDivElement;
    expect(zone).toBeTruthy();
    const dt = {
      types: [LAWMID_FS_DRAG_MIME],
      files: [],
      items: [],
      getData: (mime: string) =>
        mime === LAWMID_FS_DRAG_MIME
          ? encodeLawmindFsDrag({ root: "workspace", relPath: "contracts/nda.docx", kind: "file" })
          : "",
      dropEffect: "copy",
    } as unknown as DataTransfer;
    await act(async () => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      zone.dispatchEvent(ev);
      await Promise.resolve();
    });
    expect(onAdd).toHaveBeenCalledWith({
      root: "workspace",
      relPath: "contracts/nda.docx",
      kind: "file",
    });
  });

  it("pins a Finder file whose path is under the workspace", async () => {
    const onAdd = vi.fn();
    await act(async () => {
      root.render(<LawmindChatComposeFooter {...footerProps({ onAddFileToChatContext: onAdd })} />);
    });
    const zone = host.querySelector('[data-testid="lm-compose-drop-zone"]') as HTMLDivElement;
    const file = new File(["x"], "memo.md");
    Object.defineProperty(file, "path", { value: "/tmp/ws/notes/memo.md" });
    const dt = {
      types: ["Files"],
      files: [file],
      items: [],
      getData: () => "",
      dropEffect: "copy",
    } as unknown as DataTransfer;
    await act(async () => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt });
      zone.dispatchEvent(ev);
      await Promise.resolve();
    });
    expect(onAdd).toHaveBeenCalledWith({
      root: "workspace",
      relPath: "notes/memo.md",
      kind: "file",
    });
  });
});
