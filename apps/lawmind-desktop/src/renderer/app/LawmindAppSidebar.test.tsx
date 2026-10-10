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
    setFileExplorerCasesHost: () => {},
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
    expect(host.querySelector('[data-testid="lm-side-explorer-work"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-explorer-cases"]')).toBeTruthy();
    expect(host.textContent).toContain("合同审查");
    expect(host.textContent).not.toContain("测试案件");
  });

  it("左栏顺序：工作区 → 案件材料 → 当前案件 → 对话", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showSidebarWorkbenchFiles: true,
            mainView: "workspace",
            chatSessions: [{ sessionId: "s1", title: "合同审查" }],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: () => undefined,
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
          })}
        />,
      );
    });
    const work = host.querySelector('[data-testid="lm-side-explorer-work"]');
    const cases = host.querySelector('[data-testid="lm-side-explorer-cases"]');
    const scope = host.querySelector('[data-testid="lm-chat-scope-switcher"]');
    const chats = host.querySelector('[data-testid="lm-side-chat-sessions"]');
    expect(work && cases && scope && chats).toBeTruthy();
    expect(work!.compareDocumentPosition(cases!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cases!.compareDocumentPosition(scope!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scope!.compareDocumentPosition(chats!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("chat scope menu exposes 新建案件 with the sidebar create test id", async () => {
    let created = false;
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            mainView: "workspace",
            showSidebarWorkbenchFiles: true,
            onCreateMatter: () => {
              created = true;
            },
            chatSessions: [],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: () => undefined,
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
          })}
        />,
      );
    });
    expect(host.querySelector("[data-testid='lm-matter-sidebar-create']")).toBeNull();
    const switcher = host.querySelector("[data-testid='lm-chat-scope-switcher']") as HTMLButtonElement;
    expect(switcher).not.toBeNull();
    await act(async () => {
      switcher.click();
    });
    const create = host.querySelector("[data-testid='lm-matter-sidebar-create']") as HTMLButtonElement;
    expect(create?.textContent).toContain("新建案件");
    await act(async () => {
      create.click();
    });
    expect(created).toBe(true);
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

  it("工作台在中栏时左栏仍是会话，不另铺案件列表", async () => {
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
    expect(host.querySelector('[data-testid="lm-side-chat-sessions"]')).toBeTruthy();
  });

  it("shows the LawMind mark beside the product name", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps()} />);
    });
    const mark = host.querySelector(".lm-logo-mark svg");
    expect(mark).not.toBeNull();
    expect(host.querySelector(".lm-brand-title")?.textContent).toBe("LawMind");
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

  it("does not show 待我拍板 in the sidebar", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps({ mainView: "workspace", actionSummaryTotal: 2 })} />);
    });
    expect(host.querySelector('[data-testid="lm-side-needs-decision"]')).toBeNull();
    expect(host.textContent).not.toContain("待我拍板");
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
