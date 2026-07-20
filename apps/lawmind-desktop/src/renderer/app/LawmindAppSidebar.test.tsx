/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindAppSidebar, type LawmindAppSidebarProps } from "./LawmindAppSidebar";

function baseProps(overrides: Partial<LawmindAppSidebarProps> = {}): LawmindAppSidebarProps {
  return {
    showAppSidebar: true,
    sidebarCollapsed: false,
    sidebarWidth: 280,
    showSidebarWorkbenchFiles: false,
    showExplorerSkeleton: false,
    onSidebarResizePointerDown: () => {},
    onOpenSettings: () => {},
    onCloseSettings: () => {},
    settingsOpen: false,
    setFileExplorerHost: () => {},
    actionSummaryTotal: 0,
    matterSidebarRows: [],
    selectedMatterKey: null,
    onSelectMatterKey: () => {},
    onSelectMatterForCockpit: () => {},
    matterCockpitOpen: false,
    mainView: "workspace",
    onOpenNeedsDecisionDesk: () => {},
    ...overrides,
  };
}

describe("LawmindAppSidebar", () => {
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

  it("renders nothing when showAppSidebar is false", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ showAppSidebar: false, mainView: "review" })} />);
    });
    expect(host.innerHTML).toBe("");
  });

  it("shows workspace matter list when file tree is unavailable", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            matterSidebarRows: [
              { key: "m1", matterId: "m1", title: "测试案件", subline: "2 任务" },
            ],
          })}
        />,
      );
    });
    expect(host.querySelector(".lm-matter-sidebar-list--fill")).not.toBeNull();
    expect(host.textContent).toContain("测试案件");
  });

  it("empty matter list exposes 新建案件 CTA when onCreateMatter is set", async () => {
    let created = false;
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            matterSidebarRows: [],
            onCreateMatter: () => {
              created = true;
            },
          })}
        />,
      );
    });
    expect(host.textContent).toContain("暂无案件");
    expect(host.textContent).toContain("新建");
    expect(host.textContent).not.toContain("右键");
    const btn = host.querySelector('[data-testid="lm-matter-sidebar-create-empty"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      (btn as HTMLButtonElement).click();
    });
    expect(created).toBe(true);
  });

  it("hides matter list below file tree when workbench files are enabled", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showSidebarWorkbenchFiles: true,
            matterSidebarRows: [
              { key: "m1", matterId: "m1", title: "工作台案件", subline: "1 任务" },
            ],
          })}
        />,
      );
    });
    expect(host.querySelector(".lm-side-explorer-host")).not.toBeNull();
    expect(host.querySelector(".lm-matter-sidebar-list")).toBeNull();
    expect(host.querySelector(".lm-matter-sidebar-list--stacked")).toBeNull();
  });

  it("shows explorer skeleton while file tree is mounting", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showSidebarWorkbenchFiles: true,
            showExplorerSkeleton: true,
          })}
        />,
      );
    });
    expect(host.querySelector(".lm-side-explorer-skeleton")).not.toBeNull();
  });

  it("shows automations sidebar list on 自动办件 view when apiBase is set", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            mainView: "automations",
            apiBase: "http://127.0.0.1:9",
          })}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-automations-sidebar-list"]')).not.toBeNull();
    expect(host.textContent).toContain("交办任务");
  });

  it("shows 待我拍板 footer only when there are pending decisions", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ actionSummaryTotal: 0 })} />);
    });
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')).toBeNull();

    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ actionSummaryTotal: 2 })} />);
    });
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')?.textContent).toContain("待我拍板");
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')?.textContent).toContain("2");
  });

  it("shows 对话 session list on workspace when chat handlers are provided", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            chatSessions: [{ sessionId: "s1", title: "合同审查" }],
            activeChatSessionId: "s1",
            onSelectChatSession: () => {},
            onCreateNewChatSession: () => {},
            onRenameChatSession: () => {},
            onDeleteChatSession: () => {},
          })}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-side-chat-sessions"]')).not.toBeNull();
    expect(host.textContent).toContain("对话");
    expect(host.textContent).toContain("合同审查");
  });
});
