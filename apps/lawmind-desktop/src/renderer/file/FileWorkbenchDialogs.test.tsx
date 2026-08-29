/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkbenchDialogs } from "./FileWorkbenchDialogs";

describe("FileWorkbenchDialogs", () => {
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

  it("renders simple confirm dialog", async () => {
    const onConfirm = vi.fn();
    await act(async () => {
      root.render(
        <FileWorkbenchDialogs
          busy={false}
          confirmDialog={{
            kind: "simple",
            message: "确认删除该文件？",
            onConfirm,
          }}
          setConfirmDialog={() => {}}
          dangerInput=""
          setDangerInput={() => {}}
          addToMatterPick={null}
          setAddToMatterPick={() => {}}
          addToMatterManualDraft=""
          setAddToMatterManualDraft={() => {}}
          addToMatterLastError={null}
          setAddToMatterLastError={() => {}}
          moveWorkspaceItemIntoMatter={() => {}}
        />,
      );
    });
    expect(host.textContent).toContain("确认删除该文件？");
    const confirm = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "确认");
    expect(confirm).toBeTruthy();
    await act(async () => {
      confirm!.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders add-to-matter picker with list selection", async () => {
    const move = vi.fn();
    await act(async () => {
      root.render(
        <FileWorkbenchDialogs
          busy={false}
          mattersPickList={[{ id: "m1", label: "演示案件" }]}
          confirmDialog={null}
          setConfirmDialog={() => {}}
          dangerInput=""
          setDangerInput={() => {}}
          addToMatterPick={{ relPath: "inbox/a.pdf", kind: "file" }}
          setAddToMatterPick={() => {}}
          addToMatterManualDraft=""
          setAddToMatterManualDraft={() => {}}
          addToMatterLastError={null}
          setAddToMatterLastError={() => {}}
          moveWorkspaceItemIntoMatter={move}
        />,
      );
    });
    expect(host.textContent).toContain("加入案件");
    expect(host.textContent).toContain("演示案件");
    const pick = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("演示案件"),
    );
    await act(async () => {
      pick!.click();
    });
    expect(move).toHaveBeenCalledWith("m1", "inbox/a.pdf", "file");
  });
});
