/**
 * @vitest-environment jsdom
 *
 * 导出条上的「用 Word 打开」：导出件可能落在工作区，也可能落在会话挂的本机项目夹。
 * 以前只认工作区相对路径 —— 项目夹里的稿按钮直接消失，律师以为导出失败。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindFleetPostApproveBar } from "./LawmindFleetPostApproveBar";
import type { PostApproveExportState } from "./lawmind-post-approve-export";

function state(outputPath: string): PostApproveExportState {
  return { status: "ok", title: "买卖合同", outputPath } as PostApproveExportState;
}

describe("LawmindFleetPostApproveBar 用 Word 打开", () => {
  let host: HTMLDivElement;
  let root: Root;
  const previousDesktop = window.lawmindDesktop;
  const opened: Array<{ root?: string; path?: string }> = [];

  beforeEach(() => {
    opened.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    window.lawmindDesktop = {
      grantFileAccess: async (abs: string) => ({
        ok: true,
        root: "file:desk",
        rel: abs.split("/").pop() ?? "",
        dirPath: abs.slice(0, abs.lastIndexOf("/")),
      }),
      openWithSystem: async (payload: { root: string; path: string }) => {
        opened.push(payload);
        return { ok: true };
      },
    } as unknown as Window["lawmindDesktop"];
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    window.lawmindDesktop = previousDesktop;
  });

  async function render(exported: PostApproveExportState, projectDir: string | null): Promise<void> {
    await act(async () => {
      root.render(
        <LawmindFleetPostApproveBar
          state={exported}
          workspaceDir="/Users/shl/ws"
          projectDir={projectDir}
          onExport={() => {}}
          onDismiss={() => {}}
          onOpenError={() => {}}
        />,
      );
    });
  }

  it("项目夹里的导出件仍给出按钮，并按 project 根打开", async () => {
    await render(state("/Users/shl/matter/意见书.docx"), "/Users/shl/matter");
    const word = host.querySelector(
      '[data-testid="lm-fleet-post-approve-word"]',
    ) as HTMLButtonElement | null;
    expect(word).not.toBeNull();
    await act(async () => {
      word?.click();
    });
    expect(opened).toEqual([{ root: "project", path: "意见书.docx" }]);
  });

  it("工作区里的导出件按 workspace 根打开", async () => {
    await render(state("/Users/shl/ws/artifacts/意见书.docx"), "/Users/shl/matter");
    const word = host.querySelector(
      '[data-testid="lm-fleet-post-approve-word"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      word?.click();
    });
    expect(opened).toEqual([{ root: "workspace", path: "artifacts/意见书.docx" }]);
  });

  it("桌面上的交付件也能用 Word 打开（只读授权根），不再给不出按钮", async () => {
    const errors: string[] = [];
    await act(async () => {
      root.render(
        <LawmindFleetPostApproveBar
          state={state("/Users/shl/Desktop/意见书.docx")}
          workspaceDir="/Users/shl/ws"
          projectDir="/Users/shl/matter"
          onExport={() => {}}
          onDismiss={() => {}}
          onOpenError={(m) => errors.push(m)}
        />,
      );
    });
    const word = host.querySelector(
      '[data-testid="lm-fleet-post-approve-word"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      word?.click();
    });
    expect(opened).toEqual([{ root: "file:desk", path: "意见书.docx" }]);
    expect(errors).toEqual([]);
  });

  it("文件已被移走时把主进程的说法带出来", async () => {
    const errors: string[] = [];
    window.lawmindDesktop = {
      grantFileAccess: async () => ({ ok: false, error: "这份文件已经不在磁盘上了。" }),
      openWithSystem: async (payload: { root: string; path: string }) => {
        opened.push(payload);
        return { ok: true };
      },
    } as unknown as Window["lawmindDesktop"];
    await act(async () => {
      root.render(
        <LawmindFleetPostApproveBar
          state={state("/Users/shl/Desktop/意见书.docx")}
          workspaceDir="/Users/shl/ws"
          projectDir="/Users/shl/matter"
          onExport={() => {}}
          onDismiss={() => {}}
          onOpenError={(m) => errors.push(m)}
        />,
      );
    });
    const word = host.querySelector(
      '[data-testid="lm-fleet-post-approve-word"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      word?.click();
    });
    expect(opened).toEqual([]);
    expect(errors[0]).toContain("已经不在磁盘上了");
  });
});
