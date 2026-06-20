/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindAppSidebar } from "./LawmindAppSidebar";

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
      root.render(
        <LawmindAppSidebar
          showAppSidebar={false}
          sidebarCollapsed={false}
          sidebarWidth={280}
          showSidebarWorkbenchFiles={false}
          showExplorerSkeleton={false}
          showCollaborationSidebar={false}
          onSidebarResizePointerDown={() => {}}
          onOpenHelp={() => {}}
          onOpenSettings={() => {}}
          onCloseSettings={() => {}}
          settingsOpen={false}
          setFileExplorerHost={() => {}}
          actionSummaryTotal={0}
          actionSummaryActiveJobs={0}
          delegations={[]}
          collabEvents={[]}
          collabTab="delegations"
          onSelectCollabTab={() => {}}
          filteredTasks={[]}
          matterSidebarRows={[]}
          selectedMatterKey={null}
          onSelectMatterKey={() => {}}
          onSelectMatterForCockpit={() => {}}
          matterCockpitOpen={false}
          mainView="review"
          formatRelativeTime={() => ""}
          legalStatusLabel={() => ""}
          taskBadgeClass={() => ""}
          onOpenDetail={() => {}}
          onOpenDelegationTargetChat={() => {}}
          onOpenActionHub={() => {}}
          onRefreshCollaboration={() => {}}
          collabSummarySettings={null}
        />,
      );
    });
    expect(host.innerHTML).toBe("");
  });

  it("shows workspace matter list when file tree is unavailable", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          showAppSidebar
          sidebarCollapsed={false}
          sidebarWidth={280}
          showSidebarWorkbenchFiles={false}
          showExplorerSkeleton={false}
          showCollaborationSidebar={false}
          onSidebarResizePointerDown={() => {}}
          onOpenHelp={() => {}}
          onOpenSettings={() => {}}
          onCloseSettings={() => {}}
          settingsOpen={false}
          setFileExplorerHost={() => {}}
          actionSummaryTotal={0}
          actionSummaryActiveJobs={0}
          delegations={[]}
          collabEvents={[]}
          collabTab="delegations"
          onSelectCollabTab={() => {}}
          filteredTasks={[]}
          matterSidebarRows={[
            { key: "m1", matterId: "m1", title: "测试案件", subline: "2 任务" },
          ]}
          selectedMatterKey={null}
          onSelectMatterKey={() => {}}
          onSelectMatterForCockpit={() => {}}
          matterCockpitOpen={false}
          mainView="workspace"
          formatRelativeTime={() => ""}
          legalStatusLabel={() => ""}
          taskBadgeClass={() => ""}
          onOpenDetail={() => {}}
          onOpenDelegationTargetChat={() => {}}
          onOpenActionHub={() => {}}
          onRefreshCollaboration={() => {}}
          collabSummarySettings={null}
        />,
      );
    });
    expect(host.querySelector(".lm-matter-sidebar-list--fill")).not.toBeNull();
    expect(host.textContent).toContain("测试案件");
  });

  it("shows compact matter list below file tree when workbench files are enabled", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          showAppSidebar
          sidebarCollapsed={false}
          sidebarWidth={280}
          showSidebarWorkbenchFiles
          showExplorerSkeleton={false}
          showCollaborationSidebar={false}
          onSidebarResizePointerDown={() => {}}
          onOpenHelp={() => {}}
          onOpenSettings={() => {}}
          onCloseSettings={() => {}}
          settingsOpen={false}
          setFileExplorerHost={() => {}}
          actionSummaryTotal={0}
          actionSummaryActiveJobs={0}
          delegations={[]}
          collabEvents={[]}
          collabTab="delegations"
          onSelectCollabTab={() => {}}
          filteredTasks={[]}
          matterSidebarRows={[
            { key: "m1", matterId: "m1", title: "工作台案件", subline: "1 任务" },
          ]}
          selectedMatterKey={null}
          onSelectMatterKey={() => {}}
          onSelectMatterForCockpit={() => {}}
          matterCockpitOpen={false}
          mainView="workspace"
          formatRelativeTime={() => ""}
          legalStatusLabel={() => ""}
          taskBadgeClass={() => ""}
          onOpenDetail={() => {}}
          onOpenDelegationTargetChat={() => {}}
          onOpenActionHub={() => {}}
          onRefreshCollaboration={() => {}}
          collabSummarySettings={null}
        />,
      );
    });
    expect(host.querySelector(".lm-side-explorer-host")).not.toBeNull();
    expect(host.querySelector(".lm-matter-sidebar-list--stacked")).not.toBeNull();
    expect(host.textContent).toContain("工作台案件");
  });

  it("shows explorer skeleton while file tree is mounting", async () => {
    await act(async () => {
      root.render(
        <LawmindAppSidebar
          showAppSidebar
          sidebarCollapsed={false}
          sidebarWidth={280}
          showSidebarWorkbenchFiles
          showExplorerSkeleton
          showCollaborationSidebar={false}
          onSidebarResizePointerDown={() => {}}
          onOpenHelp={() => {}}
          onOpenSettings={() => {}}
          onCloseSettings={() => {}}
          settingsOpen={false}
          setFileExplorerHost={() => {}}
          actionSummaryTotal={0}
          actionSummaryActiveJobs={0}
          delegations={[]}
          collabEvents={[]}
          collabTab="delegations"
          onSelectCollabTab={() => {}}
          filteredTasks={[]}
          matterSidebarRows={[]}
          selectedMatterKey={null}
          onSelectMatterKey={() => {}}
          onSelectMatterForCockpit={() => {}}
          matterCockpitOpen={false}
          mainView="workspace"
          formatRelativeTime={() => ""}
          legalStatusLabel={() => ""}
          taskBadgeClass={() => ""}
          onOpenDetail={() => {}}
          onOpenDelegationTargetChat={() => {}}
          onOpenActionHub={() => {}}
          onRefreshCollaboration={() => {}}
          collabSummarySettings={null}
        />,
      );
    });
    expect(host.querySelector(".lm-side-explorer-skeleton")).not.toBeNull();
  });
});
