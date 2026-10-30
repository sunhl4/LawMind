/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAppSidebar, type LawmindAppSidebarProps } from "./LawmindAppSidebar";
import type { LawmindAppUpdateState } from "../lawmind-app-update";

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
    expect(host.querySelector('[data-testid="lm-side-explorer-cases"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-side-new-chat"]')).toBeTruthy();
    expect(host.textContent).toContain("合同审查");
    expect(host.textContent).not.toContain("测试案件");
  });

  it("左栏顺序：新建对话 → 本机目录 → 对话", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            showSidebarWorkbenchFiles: true,
            mainView: "workspace",
            chatSessions: [
              { sessionId: "s1", title: "合同审查", folderRel: "甲案" },
              { sessionId: "s2", title: "诉讼时效", workDir: "/Users/shl/nvidia/YX" },
            ],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: () => undefined,
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
            workspaceFolderLabel: "YX",
          })}
        />,
      );
    });
    const create = host.querySelector('[data-testid="lm-side-new-chat"]');
    const work = host.querySelector('[data-testid="lm-side-explorer-work"]');
    const chats = host.querySelector('[data-testid="lm-side-chat-sessions"]');
    expect(create && work && chats).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-side-explorer-cases"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-chat-scope-switcher"]')).toBeNull();
    expect(create!.compareDocumentPosition(work!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(work!.compareDocumentPosition(chats!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.textContent).toContain("YX");
    expect(host.textContent).toContain("甲案");
    expect(host.textContent).toContain("诉讼时效");
    expect(host.textContent).toContain("合同审查");
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

  it("最上面的新建对话不带文件夹", async () => {
    const created: Array<string | undefined> = [];
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            mainView: "workspace",
            showSidebarWorkbenchFiles: true,
            chatSessions: [],
            onSelectChatSession: () => undefined,
            onCreateNewChatSession: (folderRel?: string) => {
              created.push(folderRel);
            },
            onRenameChatSession: async () => undefined,
            onDeleteChatSession: async () => undefined,
          })}
        />,
      );
    });
    const create = host.querySelector("[data-testid='lm-side-new-chat']") as HTMLButtonElement;
    expect(create?.textContent).toContain("新建对话");
    await act(async () => {
      create.click();
    });
    expect(created).toEqual([undefined]);
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

describe("LawmindAppSidebar 底部账号行（Cursor 式更新入口）", () => {
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

  function downloadedState(): LawmindAppUpdateState {
    return {
      status: "downloaded",
      version: "0.4.3",
      percent: null,
      error: null,
      updatedAt: 42,
    };
  }

  it("账号行渲染：头像 + LawMind + 齿轮在底行；顶部品牌行不再有齿轮", async () => {
    await act(async () => {
      root.render(<LawmindAppSidebar {...baseProps()} />);
    });
    expect(host.querySelector(".lm-side-account-footer")).not.toBeNull();
    expect(host.querySelector(".lm-side-account-name")?.textContent).toBe("LawMind");
    expect(host.querySelector(".lm-side-account-footer .lm-gear-btn")).not.toBeNull();
    expect(host.querySelector(".lm-brand .lm-gear-btn")).toBeNull();
  });

  it("静默态（idle）不显示「更新」药丸", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({ updateStateTest: { status: "idle", version: null, percent: null, error: null, updatedAt: 1 } })}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-side-update-pill"]')).toBeNull();
  });

  it("就绪态：金色「更新」药丸可点击并触发主进程动作", async () => {
    const action = vi.fn(async () => ({ ok: true, action: "install" }));
    const prev = window.lawmindDesktop;
    // {...undefined} 与 {...{}} 等价，直接展开即可。
    window.lawmindDesktop = { ...prev, runAppUpdateAction: action } as typeof window.lawmindDesktop;
    try {
      await act(async () => {
        root.render(
          <LawmindAppSidebar {...baseProps({ updateStateTest: downloadedState() })} />,
        );
      });
      const pill = host.querySelector('[data-testid="lm-side-update-pill"]') as HTMLButtonElement;
      expect(pill).not.toBeNull();
      expect(pill.classList.contains("lm-side-update-pill-ready")).toBe(true);
      expect(pill.textContent).toBe("更新");
      await act(async () => {
        pill.click();
      });
      expect(action).toHaveBeenCalledTimes(1);
    } finally {
      window.lawmindDesktop = prev;
    }
  });

  it("下载中：药丸带百分比文案", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          {...baseProps({
            updateStateTest: {
              status: "downloading",
              version: "0.4.3",
              percent: 64,
              error: null,
              updatedAt: 7,
            },
          })}
        />,
      );
    });
    const pill = host.querySelector('[data-testid="lm-side-update-pill"]');
    expect(pill?.textContent).toBe("更新 64%");
    expect(pill?.classList.contains("lm-side-update-pill-ready")).toBe(false);
  });
});
