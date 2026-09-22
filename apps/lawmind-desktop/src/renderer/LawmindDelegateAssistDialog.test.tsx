/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindDelegateAssistDialog } from "./LawmindDelegateAssistDialog";
import type { AssistantRow } from "./lawmind-settings-models.ts";

const onlyAssistant: AssistantRow = {
  assistantId: "default",
  displayName: "默认助手",
  introduction: "",
  presetKey: "general_default",
  createdAt: "",
  updatedAt: "",
  stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
};

function renderDialog(
  root: Root,
  overrides: Partial<Parameters<typeof LawmindDelegateAssistDialog>[0]> = {},
) {
  root.render(
    <LawmindDelegateAssistDialog
      open
      apiBase="http://127.0.0.1:9"
      fromAssistantId="default"
      taskDefault="请帮忙看合同"
      assistants={[onlyAssistant]}
      delegations={[]}
      modelCatalog={[]}
      selectedModelId="m1"
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("LawmindDelegateAssistDialog", () => {
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

  it("offers 新建助手 when there are no peers", async () => {
    const onCreateAssistant = vi.fn();
    const onClose = vi.fn();
    await act(async () => {
      renderDialog(root, { onCreateAssistant, onClose });
    });
    expect(host.textContent).toContain("还没有其他助手可交接");
    const btn = host.querySelector('[data-testid="lm-delegate-create-assistant"]') as HTMLButtonElement;
    btn.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreateAssistant).toHaveBeenCalledTimes(1);
  });

  it("resets the task field when reopened", async () => {
    await act(async () => {
      renderDialog(root, { taskDefault: "初稿" });
    });
    await act(async () => {
      renderDialog(root, { open: false, taskDefault: "初稿" });
    });
    await act(async () => {
      renderDialog(root, { open: true, taskDefault: "新默认" });
    });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("新默认");
  });
});
