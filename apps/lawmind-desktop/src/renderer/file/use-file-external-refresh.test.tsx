/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FILE_EXTERNAL_REFRESH_MS,
  FILE_MTIME_REFRESH_MS,
  shouldAdoptDiskFile,
  useFileExternalRefresh,
  useFileMtimeWatcher,
} from "./use-file-external-refresh";

describe("shouldAdoptDiskFile", () => {
  const base = {
    dirty: false,
    tabMtimeMs: 100,
    diskMtimeMs: 200,
    tabContent: "旧正文",
    diskContent: "新正文",
  };

  it("adopts a newer disk copy when the tab is clean", () => {
    expect(shouldAdoptDiskFile(base)).toBe(true);
  });

  it("never overwrites unsaved edits", () => {
    expect(shouldAdoptDiskFile({ ...base, dirty: true })).toBe(false);
  });

  it("ignores the same mtime", () => {
    expect(shouldAdoptDiskFile({ ...base, diskMtimeMs: 100 })).toBe(false);
  });

  it("ignores identical content even when the mtime moved", () => {
    expect(shouldAdoptDiskFile({ ...base, diskContent: "旧正文" })).toBe(false);
  });

  it("ignores unreadable disk metadata", () => {
    expect(shouldAdoptDiskFile({ ...base, diskMtimeMs: undefined })).toBe(false);
    expect(shouldAdoptDiskFile({ ...base, diskContent: undefined })).toBe(false);
  });
});

const onReload = vi.hoisted(() => vi.fn());
const onMtimeChanged = vi.hoisted(() => vi.fn());

type HarnessProps = {
  dirty?: boolean;
  enabled?: boolean;
  mtimeMs?: number;
  content?: string;
};

function Harness({
  dirty = false,
  enabled = true,
  mtimeMs = 100,
  content = "旧正文",
}: HarnessProps) {
  useFileExternalRefresh({
    enabled,
    root: "workspace",
    path: "cases/m/notes.md",
    mtimeMs,
    content,
    dirty,
    onReload,
  });
  return <div />;
}

describe("useFileExternalRefresh", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let disk: { content: string; mtimeMs: number };
  let fsStat: ReturnType<typeof vi.fn>;
  let fsRead: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onReload.mockClear();
    onMtimeChanged.mockClear();
    disk = { content: "旧正文", mtimeMs: 100 };
    fsStat = vi.fn(async () => ({ ok: true, kind: "file" as const, mtimeMs: disk.mtimeMs }));
    fsRead = vi.fn(async () => ({ ok: true, kind: "text" as const, ...disk }));
    window.lawmindDesktop = { fsStat, fsRead } as unknown as typeof window.lawmindDesktop;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    host?.remove();
    host = null;
    delete window.lawmindDesktop;
    vi.useRealTimers();
  });

  async function mount(props: HarnessProps = {}): Promise<void> {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Harness {...props} />);
    });
  }

  it("reloads the tab when the file changed on disk", async () => {
    await mount();
    disk = { content: "新正文", mtimeMs: 200 };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_EXTERNAL_REFRESH_MS);
    });

    expect(fsStat).toHaveBeenCalledWith({ root: "workspace", path: "cases/m/notes.md" });
    expect(fsRead).toHaveBeenCalledWith({ root: "workspace", path: "cases/m/notes.md" });
    expect(onReload).toHaveBeenCalledWith({ content: "新正文", mtimeMs: 200 });
  });

  it("keeps unsaved edits untouched", async () => {
    await mount({ dirty: true });
    disk = { content: "新正文", mtimeMs: 200 };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_EXTERNAL_REFRESH_MS * 2);
    });

    expect(fsStat).not.toHaveBeenCalled();
    expect(fsRead).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("does not read the body when the mtime is unchanged", async () => {
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_EXTERNAL_REFRESH_MS * 2);
    });
    expect(fsStat).toHaveBeenCalled();
    expect(fsRead).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
  });
});

type MtimeHarnessProps = {
  mtimeMs?: number;
  dirty?: boolean;
  enabled?: boolean;
};

function MtimeHarness({ mtimeMs = 100, dirty = false, enabled = true }: MtimeHarnessProps) {
  useFileMtimeWatcher({
    enabled,
    root: "workspace",
    path: "cases/m/evidence.pdf",
    mtimeMs,
    dirty,
    onChanged: onMtimeChanged,
  });
  return <div />;
}

describe("useFileMtimeWatcher", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let diskMtime = 100;
  let fsStat: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onMtimeChanged.mockClear();
    diskMtime = 100;
    fsStat = vi.fn(async () => ({ ok: true, kind: "file" as const, mtimeMs: diskMtime }));
    window.lawmindDesktop = { fsStat } as unknown as typeof window.lawmindDesktop;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    host?.remove();
    host = null;
    delete window.lawmindDesktop;
    vi.useRealTimers();
  });

  async function mount(props: MtimeHarnessProps = {}): Promise<void> {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<MtimeHarness {...props} />);
    });
  }

  it("fires once when the disk mtime moves, then stays quiet", async () => {
    await mount({ mtimeMs: 100 });
    diskMtime = 200;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_MTIME_REFRESH_MS);
    });
    expect(onMtimeChanged).toHaveBeenCalledTimes(1);
    expect(onMtimeChanged).toHaveBeenCalledWith(200);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_MTIME_REFRESH_MS * 2);
    });
    expect(onMtimeChanged).toHaveBeenCalledTimes(1);
  });

  it("does not poll while the viewer has unsaved edits", async () => {
    await mount({ mtimeMs: 100, dirty: true });
    diskMtime = 200;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_MTIME_REFRESH_MS * 2);
    });
    expect(fsStat).not.toHaveBeenCalled();
    expect(onMtimeChanged).not.toHaveBeenCalled();
  });

  it("picks up later changes after the viewer updates its known mtime", async () => {
    await mount({ mtimeMs: 100 });
    diskMtime = 200;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_MTIME_REFRESH_MS);
    });

    await act(async () => {
      root?.render(<MtimeHarness mtimeMs={200} />);
    });
    diskMtime = 300;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_MTIME_REFRESH_MS);
    });
    expect(onMtimeChanged).toHaveBeenCalledTimes(2);
    expect(onMtimeChanged).toHaveBeenLastCalledWith(300);
  });
});
