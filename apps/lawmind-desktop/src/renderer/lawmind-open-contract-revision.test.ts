/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGetJson = vi.hoisted(() => vi.fn());

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => apiGetJson(...args),
}));

import {
  clearPendingDraftDesk,
  LAWMIND_OPEN_DRAFT_DESK_EVENT,
  openContractRevisionForTask,
  openDocxInReviewSurface,
  taskIdForReviewFile,
} from "./lawmind-open-contract-revision";
import {
  LAWMIND_OPEN_WORKSPACE_FILE_EVENT,
  revisionColumnTarget,
} from "./lawmind-workspace-file-open";

describe("taskIdForReviewFile", () => {
  it("opens the draft bound to the original when the chat link is the exported copy", () => {
    const taskId = taskIdForReviewFile(
      [
        {
          taskId: "task-9",
          outputPath: "/Users/shl/nvidia/YX/非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同_20260928_01.docx",
          contractEdit: {
            baselineRelativePath: "非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同.docx",
          },
        },
      ],
      "非技术相关/采购合同模板/基建工程类合同/国浩改-26年9月-装饰装修施工合同_20260928_01.docx",
    );
    expect(taskId).toBe("task-9");
  });

  it("opens the draft whose title is the chat filename, even when the original path differs", () => {
    const taskId = taskIdForReviewFile(
      [
        {
          taskId: "task-buy",
          title: "国浩改-26年9月-通用采购合同（修订稿）",
          contractEdit: {
            baselineRelativePath: "非技术相关/通用采购合同（修订稿）.docx",
          },
        },
      ],
      "非技术相关/国浩改-26年9月-通用采购合同（修订稿）.docx",
    );
    expect(taskId).toBe("task-buy");
  });
});

describe("revisionColumnTarget", () => {
  it("maps a project-directory docx onto the project root", () => {
    expect(
      revisionColumnTarget(
        { outputPath: "/Users/shl/matter/劳动法检索备忘_20261016_01.docx" },
        "/Users/shl/workspace",
        "/Users/shl/matter",
      ),
    ).toEqual({ relPath: "劳动法检索备忘_20261016_01.docx", root: "project" });
  });
});

describe("opening a chat Word link", () => {
  afterEach(() => {
    apiGetJson.mockReset();
    clearPendingDraftDesk();
  });

  function listen(eventName: string): {
    events: Array<{ relPath?: string; root?: string; taskId?: string }>;
    stop: () => void;
  } {
    const events: Array<{ relPath?: string; root?: string; taskId?: string }> = [];
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ relPath?: string; root?: string; taskId?: string }>).detail;
      events.push({
        ...(detail?.relPath ? { relPath: detail.relPath, root: detail.root } : {}),
        ...(detail?.taskId ? { taskId: detail.taskId } : {}),
      });
    };
    window.addEventListener(eventName, onEvent);
    return {
      events,
      stop() {
        window.removeEventListener(eventName, onEvent);
      },
    };
  }

  it("opens the clicked file when the same-titled draft has no Word original", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      drafts: [{ taskId: "task-labor", title: "劳动法检索备忘" }],
    });
    const files = listen(LAWMIND_OPEN_WORKSPACE_FILE_EVENT);
    const desks = listen(LAWMIND_OPEN_DRAFT_DESK_EVENT);
    const onTask = vi.fn();
    await openDocxInReviewSurface({
      relPath: "劳动法检索备忘_20261016_01.docx",
      apiBase: "http://127.0.0.1:9",
      onTask,
    });
    expect(onTask).not.toHaveBeenCalled();
    expect(files.events).toEqual([{ relPath: "劳动法检索备忘_20261016_01.docx", root: "project" }]);
    expect(desks.events).toEqual([]);
    files.stop();
    desks.stop();
  });

  it("still opens the bound original when the draft has one", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      drafts: [
        {
          taskId: "task-buy",
          title: "国浩改-26年9月-通用采购合同（修订稿）",
          contractEdit: { baselineRelativePath: "非技术相关/通用采购合同（修订稿）.docx" },
        },
      ],
    });
    const files = listen(LAWMIND_OPEN_WORKSPACE_FILE_EVENT);
    const onTask = vi.fn();
    await openDocxInReviewSurface({
      relPath: "非技术相关/国浩改-26年9月-通用采购合同（修订稿）.docx",
      apiBase: "http://127.0.0.1:9",
      onTask,
    });
    expect(onTask).toHaveBeenCalledWith("task-buy");
    expect(files.events).toEqual([]);
    files.stop();
  });

  it("opens the draft desk when a draft link has no Word file", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      draft: { taskId: "task-labor", title: "劳动法检索备忘" },
    });
    const files = listen(LAWMIND_OPEN_WORKSPACE_FILE_EVENT);
    const desks = listen(LAWMIND_OPEN_DRAFT_DESK_EVENT);
    const result = await openContractRevisionForTask({
      apiBase: "http://127.0.0.1:9",
      taskId: "task-labor",
    });
    expect(result).toEqual({ ok: true });
    expect(files.events).toEqual([]);
    expect(desks.events).toEqual([{ taskId: "task-labor" }]);
    files.stop();
    desks.stop();
  });

  it("opens the clicked file when revision is requested with a fallback path", async () => {
    apiGetJson.mockResolvedValue({
      ok: true,
      draft: { taskId: "task-labor", title: "劳动法检索备忘" },
    });
    const files = listen(LAWMIND_OPEN_WORKSPACE_FILE_EVENT);
    const result = await openContractRevisionForTask({
      apiBase: "http://127.0.0.1:9",
      taskId: "task-labor",
      fallbackRelPath: "劳动法检索备忘_20261016_01.docx",
    });
    expect(result).toEqual({ ok: true });
    expect(files.events).toEqual([{ relPath: "劳动法检索备忘_20261016_01.docx", root: "project" }]);
    files.stop();
  });
});
