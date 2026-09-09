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

  it("renders nothing when settings is open", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ settingsOpen: true, mainView: "workspace" })} />);
    });
    expect(host.innerHTML).toBe("");
  });

  it("在办 shows chat sessions + materials explorer like 对话 (not matter list)", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showAppSidebar: true,
            showSidebarWorkbenchFiles: true,
            mainView: "agents",
            chatSessions: [{ sessionId: "s1", title: "合同审查" }],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: () => undefined,
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
            matterSidebarRows: [
              { key: "m1", matterId: "m1", title: "测试案件", subline: "2 任务" },
            ],
          })}
        />,
      );
    });
    expect(host.querySelector('[aria-label="材料资源树"]')).toBeTruthy();
    expect(host.textContent).toContain("合同审查");
    expect(host.textContent).not.toContain("测试案件");
  });

  it("会议室复用全局侧栏材料树（与对话同构）", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showAppSidebar: true,
            mainView: "meeting",
            showSidebarWorkbenchFiles: true,
            matterSidebarRows: [
              { key: "m1", matterId: "m1", title: "测试案件", subline: "2 任务" },
            ],
          })}
        />,
      );
    });
    expect(host.querySelector(".lm-side-explorer-host")).toBeTruthy();
    expect(host.querySelector(".lm-matter-sidebar-list")).toBeNull();
  });

  it("empty matter list exposes 新建案件 CTA when onCreateMatter is set", async () => {
    let created = false;
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            // Matter list appears on workspace when materials tree is not mounted.
            mainView: "workspace",
            showSidebarWorkbenchFiles: false,
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

  it("hides 案件 list on chat workspace (materials / sessions only)", async () => {
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
    expect(host.textContent).not.toContain("工作台案件");
    expect(host.querySelector("[data-testid='lm-cockpit-nav']")).toBeNull();
  });

  it("工作台不占用全局侧栏（案件在驾驶舱内）", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            mainView: "desk",
            showSidebarWorkbenchFiles: false,
            matterSidebarRows: [
              { key: "m1", matterId: "m1", title: "借贷案", subline: "诉讼" },
            ],
            chatSessions: [{ sessionId: "s1", title: "合同审查" }],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: () => undefined,
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
          })}
        />,
      );
    });
    expect(host.querySelector(".lm-matter-sidebar-list")).toBeNull();
    expect(host.textContent).not.toContain("借贷案");
    expect(host.querySelector('[aria-label="材料资源树"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-side-chat-sessions"]')).toBeNull();
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

  it("shows 待我拍板 only when there are pending decisions", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ mainView: "workspace", actionSummaryTotal: 0 })} />);
    });
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')).toBeNull();

    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ mainView: "agents", actionSummaryTotal: 2 })} />);
    });
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')?.textContent).toContain("待我拍板");
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')?.textContent).toContain("2");
    expect(host.querySelector('[data-testid="lm-side-collab-completed"]')).toBeNull();
    expect(host.textContent).not.toContain("刚办完");
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
