/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindMsgAssistant } from "./LawmindMsgAssistant";

const openContractRevisionForTask = vi.fn();

vi.mock("./lawmind-open-contract-revision", () => ({
  openContractRevisionForTask: (...args: unknown[]) => openContractRevisionForTask(...args),
}));

describe("LawmindMsgAssistant word check", () => {
  const hosts: HTMLDivElement[] = [];

  afterEach(() => {
    openContractRevisionForTask.mockReset();
    for (const host of hosts.splice(0)) {
      host.remove();
    }
  });

  it("shows 去核对 beside the review sentence and opens the revision window", async () => {
    openContractRevisionForTask.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindMsgAssistant
          apiBase="http://127.0.0.1:9"
          text={"已写出源文件同目录审阅稿：/tmp/合同_20260928_01.docx\n\n[[word-check:task-9]]"}
        />,
      );
    });
    expect(host.textContent).toContain("已写出源文件同目录审阅稿");
    expect(host.textContent).not.toContain("[[word-check:");
    const button = host.querySelector<HTMLButtonElement>("[data-testid='lm-word-check-open']");
    expect(button?.textContent).toContain("去核对");
    await act(async () => {
      button?.click();
    });
    expect(openContractRevisionForTask).toHaveBeenCalledWith({
      apiBase: "http://127.0.0.1:9",
      taskId: "task-9",
      workspaceDir: undefined,
    });
    act(() => root.unmount());
  });
});
