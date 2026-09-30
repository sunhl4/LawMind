/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindMsgAssistant } from "./LawmindMsgAssistant";

const openDeliverableInWps = vi.fn();
const revealDeliverableInFolder = vi.fn();
const openContractRevisionForTask = vi.fn();

vi.mock("./lawmind-open-contract-revision", () => ({
  openContractRevisionForTask: (...args: unknown[]) => openContractRevisionForTask(...args),
}));

vi.mock("./canvas/host-actions", () => ({
  openDeliverableInWps: (...args: unknown[]) => openDeliverableInWps(...args),
  revealDeliverableInFolder: (...args: unknown[]) => revealDeliverableInFolder(...args),
}));

describe("LawmindMsgAssistant word check", () => {
  const hosts: HTMLDivElement[] = [];

  afterEach(() => {
    openContractRevisionForTask.mockReset();
    openDeliverableInWps.mockReset();
    revealDeliverableInFolder.mockReset();
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
    const button = [...host.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("去核对"),
    );
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

  it("left-clicks the file into review, and right-click offers the folder or WPS", async () => {
    openContractRevisionForTask.mockResolvedValue({ ok: true });
    openDeliverableInWps.mockResolvedValue({ ok: true });
    revealDeliverableInFolder.mockResolvedValue({ ok: true });
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <LawmindMsgAssistant
          apiBase="http://127.0.0.1:9"
          text={"审阅稿已写好：非技术相关/合同_20260928_01.docx\n\n[[word-check:task-9|非技术相关/合同_20260928_01.docx]]"}
        />,
      );
    });
    const link = host.querySelector<HTMLButtonElement>("[data-testid='lm-word-check-open']");
    expect(link?.textContent).toContain("合同_20260928_01.docx");
    await act(async () => {
      link?.click();
    });
    expect(openContractRevisionForTask).toHaveBeenCalledWith({
      apiBase: "http://127.0.0.1:9",
      taskId: "task-9",
      workspaceDir: undefined,
    });
    expect(openDeliverableInWps).not.toHaveBeenCalled();
    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }),
      );
    });
    const reveal = document.body.querySelector<HTMLButtonElement>("[data-testid='lm-word-check-reveal']");
    const wps = document.body.querySelector<HTMLButtonElement>("[data-testid='lm-word-check-wps']");
    expect(reveal?.textContent).toContain("去本机文件所在目录");
    expect(wps?.textContent).toContain("用本机应用打开");
    await act(async () => {
      reveal?.click();
    });
    expect(revealDeliverableInFolder).toHaveBeenCalledWith("非技术相关/合同_20260928_01.docx");
    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }),
      );
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-testid='lm-word-check-wps']")?.click();
    });
    expect(openDeliverableInWps).toHaveBeenCalledWith("非技术相关/合同_20260928_01.docx");
    act(() => root.unmount());
  });
});
