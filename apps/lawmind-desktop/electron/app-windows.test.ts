import { describe, expect, it } from "vitest";
import {
  isAllowedMainWindowNavigationUrl,
  isAuxPopoutWindowUrl,
  isDevToolsWindowUrl,
  resolveAuxWindowRequest,
  shouldKeepLocalServerAlive,
} from "./app-windows.mjs";

describe("isDevToolsWindowUrl", () => {
  it("matches detached DevTools", () => {
    expect(isDevToolsWindowUrl("devtools://devtools/bundled/devtools_app.html")).toBe(true);
  });

  it("does not match LawMind renderer URLs", () => {
    expect(isDevToolsWindowUrl("http://127.0.0.1:5174/")).toBe(false);
    expect(isDevToolsWindowUrl("file:///Applications/LawMind.app/Contents/Resources/dist/index.html")).toBe(
      false,
    );
  });
});

describe("isAuxPopoutWindowUrl", () => {
  it("matches review preview hash", () => {
    expect(isAuxPopoutWindowUrl("http://127.0.0.1:5174/#lm-popout=review-preview&taskId=t1")).toBe(true);
  });

  it("matches a detached workspace pane hash", () => {
    expect(
      isAuxPopoutWindowUrl("http://127.0.0.1:5174/#lm-popout=workspace-pane&pane=chat&sessionId=s1"),
    ).toBe(true);
  });

  it("does not match the main workspace", () => {
    expect(isAuxPopoutWindowUrl("http://127.0.0.1:5174/")).toBe(false);
  });
});

describe("resolveAuxWindowRequest", () => {
  it("keeps the review preview contract", () => {
    const spec = resolveAuxWindowRequest({ kind: "review-preview", taskId: "t-1" });
    expect(spec.ok).toBe(true);
    if (!spec.ok) {
      return;
    }
    expect(spec.key).toBe("review-preview:t-1");
    expect(spec.hash).toBe("lm-popout=review-preview&taskId=t-1");
    expect(spec.width).toBe(720);
  });

  it("builds a narrow chat window keyed by session", () => {
    const spec = resolveAuxWindowRequest({
      kind: "workspace-pane",
      pane: "chat",
      sessionId: "s-1",
      assistantId: "a-1",
      matterId: "m-1",
    });
    expect(spec.ok).toBe(true);
    if (!spec.ok) {
      return;
    }
    expect(spec.key).toBe("workspace-pane:chat:s-1");
    expect(spec.title).toBe("对话");
    expect(spec.width).toBe(560);
    const hash = new URLSearchParams(spec.hash);
    expect(hash.get("lm-popout")).toBe("workspace-pane");
    expect(hash.get("pane")).toBe("chat");
    expect(hash.get("sessionId")).toBe("s-1");
    expect(hash.get("assistantId")).toBe("a-1");
    expect(hash.get("matterId")).toBe("m-1");
  });

  it("keys the middle window by draft > file > matter", () => {
    const draft = resolveAuxWindowRequest({
      kind: "workspace-pane",
      pane: "middle",
      matterId: "m-1",
      draftTaskId: "d-1",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) {
      return;
    }
    expect(draft.key).toBe("workspace-pane:middle:d-1");
    expect(draft.width).toBe(960);

    const matter = resolveAuxWindowRequest({
      kind: "workspace-pane",
      pane: "middle",
      matterId: "m-1",
    });
    expect(matter.ok).toBe(true);
    if (!matter.ok) {
      return;
    }
    expect(matter.key).toBe("workspace-pane:middle:m-1");

    const file = resolveAuxWindowRequest({
      kind: "workspace-pane",
      pane: "middle",
      middleView: "file",
      relPath: "artifacts/a.docx",
      root: "project",
    });
    expect(file.ok).toBe(true);
    if (!file.ok) {
      return;
    }
    expect(file.key).toBe("workspace-pane:middle:project:artifacts/a.docx");
    const fileHash = new URLSearchParams(file.hash);
    expect(fileHash.get("middleView")).toBe("file");
    expect(fileHash.get("relPath")).toBe("artifacts/a.docx");
    expect(fileHash.get("root")).toBe("project");

    // 带案件上下文的文件窗仍按文件区分：否则同案第二份文件只会聚焦回旧窗。
    const fileInMatter = resolveAuxWindowRequest({
      kind: "workspace-pane",
      pane: "middle",
      matterId: "m-1",
      middleView: "file",
      relPath: "artifacts/b.docx",
      root: "project",
    });
    expect(fileInMatter.ok).toBe(true);
    if (!fileInMatter.ok) {
      return;
    }
    expect(fileInMatter.key).toBe("workspace-pane:middle:project:artifacts/b.docx");
    expect(new URLSearchParams(fileInMatter.hash).get("matterId")).toBe("m-1");
  });

  it("rejects unknown kinds and panes", () => {
    expect(resolveAuxWindowRequest({ kind: "nope" })).toEqual({
      ok: false,
      error: "invalid_aux_window",
    });
    expect(resolveAuxWindowRequest({ kind: "workspace-pane", pane: "settings" })).toEqual({
      ok: false,
      error: "invalid_aux_window",
    });
  });
});

describe("isAllowedMainWindowNavigationUrl (will-navigate 防护)", () => {
  const opts = {
    devServerUrl: "http://127.0.0.1:5174",
    distIndexPath: "/Applications/LawMind.app/Contents/Resources/dist/index.html",
  };

  it("allows the packaged renderer file:// under dist/", () => {
    expect(
      isAllowedMainWindowNavigationUrl(
        "file:///Applications/LawMind.app/Contents/Resources/dist/index.html",
        opts,
      ),
    ).toBe(true);
    expect(
      isAllowedMainWindowNavigationUrl(
        "file:///Applications/LawMind.app/Contents/Resources/dist/assets/app.js",
        opts,
      ),
    ).toBe(true);
  });

  it("allows the dev server origin (loopback spelling variants)", () => {
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:5174/", opts)).toBe(true);
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:5174/#lm-popout=review-preview", opts)).toBe(
      true,
    );
    expect(isAllowedMainWindowNavigationUrl("http://localhost:5174/", opts)).toBe(true);
  });

  it("blocks remote https pages (token + fs bridge exposure)", () => {
    expect(isAllowedMainWindowNavigationUrl("https://evil.example/phish", opts)).toBe(false);
  });

  it("blocks other loopback ports and non-dist file paths", () => {
    expect(isAllowedMainWindowNavigationUrl("http://127.0.0.1:9999/", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl("file:///etc/passwd", opts)).toBe(false);
  });

  it("blocks non-http(s)/file protocols and garbage", () => {
    expect(isAllowedMainWindowNavigationUrl("devtools://devtools/bundled/devtools_app.html", opts)).toBe(
      false,
    );
    expect(isAllowedMainWindowNavigationUrl("not a url", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl("", opts)).toBe(false);
    expect(isAllowedMainWindowNavigationUrl(undefined, opts)).toBe(false);
  });
});

describe("shouldKeepLocalServerAlive", () => {
  it("keeps the API when the main window is still up (DevTools / aux closed)", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: true,
        auxAliveCount: 0,
        remainingAppWindowCount: 0,
      }),
    ).toBe(true);
  });

  it("keeps the API when an aux preview remains after the main window closed", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 1,
        remainingAppWindowCount: 1,
      }),
    ).toBe(true);
  });

  it("keeps the API when any non-DevTools window remains", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 0,
        remainingAppWindowCount: 1,
      }),
    ).toBe(true);
  });

  it("allows shutdown only when no app windows remain", () => {
    expect(
      shouldKeepLocalServerAlive({
        mainAlive: false,
        auxAliveCount: 0,
        remainingAppWindowCount: 0,
      }),
    ).toBe(false);
  });
});
