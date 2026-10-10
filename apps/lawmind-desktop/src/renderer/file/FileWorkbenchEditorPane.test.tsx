/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWorkbenchEditorPane } from "./FileWorkbenchEditorPane";
import { wpsTabLabel } from "./file-tab-layout";
import type { OpenFileTab } from "./file-workbench-types";

vi.mock("./LawmindWordRevisionSurface", () => ({
  LawmindWordRevisionSurface: (props: { fileName: string; relPath: string }) => (
    <div data-testid="lm-word-surface-stub">
      {props.fileName}:{props.relPath}
    </div>
  ),
}));

vi.mock("./PdfFileView", () => ({
  PdfFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-pdf">PDF:{props.tab.name}</div>
  ),
}));

vi.mock("./XlsxFileView", () => ({
  XlsxFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-xlsx">XLSX:{props.tab.name}</div>
  ),
}));

vi.mock("./MediaFileView", () => ({
  MediaFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-media">MEDIA:{props.tab.name}</div>
  ),
}));

vi.mock("./EmlFileView", () => ({
  EmlFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-eml">EML:{props.tab.name}</div>
  ),
}));

vi.mock("./ZipFileView", () => ({
  ZipFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-zip">ZIP:{props.tab.name}</div>
  ),
}));

vi.mock("./DocFileView", () => ({
  DocFileView: (props: { tab: { name: string } }) => (
    <div data-testid="lm-preview-doc">DOC:{props.tab.name}</div>
  ),
}));

function textTab(overrides: Partial<OpenFileTab> = {}): OpenFileTab {
  return {
    id: "workspace:notes.md",
    root: "workspace",
    path: "notes.md",
    name: "notes.md",
    kind: "text",
    content: "hello",
    savedContent: "hello",
    mtimeMs: 1,
    ...overrides,
  };
}

function wordTab(path: string, name: string): OpenFileTab {
  return {
    id: `workspace:${path}`,
    root: "workspace",
    path,
    name,
    kind: "word",
    content: "",
    savedContent: "",
    mtimeMs: 0,
  };
}

describe("FileWorkbenchEditorPane", () => {
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

  it("routes text / word / pdf / fallback kinds to the matching panel", async () => {
    const word = wordTab("a.docx", "a.docx");
    const pdf: OpenFileTab = {
      id: "workspace:b.pdf",
      root: "workspace",
      path: "b.pdf",
      name: "b.pdf",
      kind: "pdf",
      content: "",
      savedContent: "",
      mtimeMs: 0,
    };
    const text = textTab();

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[text, word, pdf]}
          activeTabId={word.id}
          setActiveTabId={() => {}}
          activeTab={word}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
          apiBase="http://127.0.0.1:9"
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-preview-active-word"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="lm-word-surface-stub"]')?.textContent).toContain("a.docx");

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[text, word, pdf]}
          activeTabId={pdf.id}
          setActiveTabId={() => {}}
          activeTab={pdf}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-preview-active-pdf"]')).toBeTruthy();
    expect(host.textContent).toContain("PDF:b.pdf");

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[text, word, pdf]}
          activeTabId={text.id}
          setActiveTabId={() => {}}
          activeTab={text}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
        />,
      );
    });
    // .md 默认阅读预览；点「源码」才进 textarea
    expect(host.querySelector('[data-testid="lm-md-file-preview"]')).toBeTruthy();
    expect(host.querySelector("textarea.lm-editor-textarea")).toBeNull();
  });

  it("renders markdown preview by default and can switch to source", async () => {
    const md = textTab({
      content: "## 生成产物\n\n- **通过门禁**\n- 见 `合同.docx`",
      savedContent: "## 生成产物\n\n- **通过门禁**\n- 见 `合同.docx`",
    });
    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[md]}
          activeTabId={md.id}
          setActiveTabId={() => {}}
          activeTab={md}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
        />,
      );
    });
    const preview = host.querySelector('[data-testid="lm-md-file-preview"]');
    expect(preview).toBeTruthy();
    expect(preview?.textContent).toContain("生成产物");
    expect(preview?.textContent).toContain("通过门禁");
    expect(preview?.textContent).not.toContain("## 生成产物");
    expect(preview?.querySelector("strong")?.textContent).toBe("通过门禁");
    expect(preview?.querySelector("code")?.textContent).toBe("合同.docx");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-md-preview-toggle"]')?.click();
    });
    const area = host.querySelector<HTMLTextAreaElement>("textarea.lm-editor-textarea");
    expect(area?.value).toContain("## 生成产物");
    expect(host.querySelector('[data-testid="lm-md-file-preview"]')).toBeNull();
  });

  it("renders document tabs with a type mark, ellipsis label, and a close icon", async () => {
    const pdf: OpenFileTab = {
      id: "workspace:SQD.pdf",
      root: "workspace",
      path: "SQD.pdf",
      name: "SQD.pdf",
      kind: "pdf",
      content: "",
      savedContent: "",
      mtimeMs: 0,
    };
    const sheet: OpenFileTab = {
      id: "workspace:price.xlsx",
      root: "workspace",
      path: "price.xlsx",
      name: "吉利项目价格拆解（国浩）20260228v1.xlsx",
      kind: "xlsx",
      content: "",
      savedContent: "",
      mtimeMs: 0,
    };
    const dirty = textTab({ content: "changed", savedContent: "hello" });

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[pdf, sheet, dirty]}
          activeTabId={sheet.id}
          setActiveTabId={() => {}}
          activeTab={sheet}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
        />,
      );
    });

    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.querySelector(".lm-file-type-mark.is-pdf")).toBeTruthy();
    expect(tabs[1]?.querySelector(".lm-file-type-mark.is-sheet")).toBeTruthy();
    expect(tabs[1]?.classList.contains("active")).toBe(true);
    expect(tabs[0]?.querySelector(".lm-file-tab-label")?.textContent).toBe("SQD.pdf");
    expect(tabs[1]?.querySelector(".lm-file-tab-label")?.textContent).toBe(wpsTabLabel(sheet.name));
    expect(tabs[1]?.querySelector(".lm-file-tab-label")?.textContent?.endsWith("…")).toBe(true);
    expect(tabs[1]?.querySelector(".lm-file-tab-label")?.textContent).not.toContain(".xlsx");
    expect(tabs[1]?.getAttribute("title")).toBeNull();
    expect(tabs[1]?.querySelector(".lm-file-tab-x")).toBeTruthy();
    expect(tabs[1]?.querySelector(".lm-file-tab-close")?.textContent).not.toContain("×");
    expect(tabs[2]?.classList.contains("dirty")).toBe(true);
    expect(tabs[2]?.querySelector(".lm-file-tab-dirty")).toBeTruthy();
  });

  it("hovering a tab shows the full name, local path, and 带入到对话", async () => {
    vi.useFakeTimers();
    try {
      const onAdd = vi.fn();
      const sheet: OpenFileTab = {
        id: "workspace:price.xlsx",
        root: "workspace",
        path: "paper/price.xlsx",
        name: "吉利项目价格拆解（国浩）20260228v1.xlsx",
        kind: "xlsx",
        content: "",
        savedContent: "",
        mtimeMs: 0,
      };
      await act(async () => {
        root.render(
          <FileWorkbenchEditorPane
            tabs={[sheet]}
            activeTabId={sheet.id}
            setActiveTabId={() => {}}
            activeTab={sheet}
            activeDirty={false}
            busy={false}
            onAddToChatContext={onAdd}
            setError={() => {}}
            closeTab={() => {}}
            updateActiveContent={() => {}}
            saveActive={() => {}}
            saveActiveAs={() => {}}
            doShowInFolder={() => {}}
            workspaceDir="/Users/shl/Paper"
          />,
        );
      });
      const tab = host.querySelector('[role="tab"]');
      await act(async () => {
        tab?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        vi.advanceTimersByTime(400);
      });
      expect(host.textContent).toContain(sheet.name);
      expect(host.textContent).toContain("Users › shl › Paper › paper › price.xlsx");
      const add = [...host.querySelectorAll("button")].find((button) => button.textContent === "带入到对话");
      expect(add).toBeTruthy();
      await act(async () => {
        add?.click();
      });
      expect(onAdd).toHaveBeenCalledWith({ root: "workspace", relPath: "paper/price.xlsx", kind: "file" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes xlsx and media kinds to their preview panels", async () => {
    const xlsx: OpenFileTab = {
      id: "workspace:ledger.xlsx",
      root: "workspace",
      path: "ledger.xlsx",
      name: "ledger.xlsx",
      kind: "xlsx",
      content: "",
      savedContent: "",
      mtimeMs: 0,
    };
    const media: OpenFileTab = {
      id: "workspace:hearing.mp3",
      root: "workspace",
      path: "hearing.mp3",
      name: "hearing.mp3",
      kind: "media",
      content: "",
      savedContent: "",
      mtimeMs: 0,
    };

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[xlsx, media]}
          activeTabId={xlsx.id}
          setActiveTabId={() => {}}
          activeTab={xlsx}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
          apiBase="http://127.0.0.1:9"
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-preview-active-xlsx"]')).toBeTruthy();
    expect(host.textContent).toContain("XLSX:ledger.xlsx");
    expect(host.textContent).not.toContain("本页暂不支持该 Office 格式");

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[xlsx, media]}
          activeTabId={media.id}
          setActiveTabId={() => {}}
          activeTab={media}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
          apiBase="http://127.0.0.1:9"
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-preview-active-media"]')).toBeTruthy();
    expect(host.textContent).toContain("MEDIA:hearing.mp3");
  });

  it("keeps two word tabs mounted so switching does not drop the inactive surface", async () => {
    const a = wordTab("甲方.docx", "甲方.docx");
    const b = wordTab("乙方.docx", "乙方.docx");
    const setActiveTabId = vi.fn();

    await act(async () => {
      root.render(
        <FileWorkbenchEditorPane
          tabs={[a, b]}
          activeTabId={a.id}
          setActiveTabId={setActiveTabId}
          activeTab={a}
          activeDirty={false}
          busy={false}
          setError={() => {}}
          closeTab={() => {}}
          updateActiveContent={() => {}}
          saveActive={() => {}}
          saveActiveAs={() => {}}
          doShowInFolder={() => {}}
          apiBase="http://127.0.0.1:9"
        />,
      );
    });

    const stubs = host.querySelectorAll('[data-testid="lm-word-surface-stub"]');
    expect(stubs).toHaveLength(2);
    expect(stubs[0]?.textContent).toContain("甲方.docx");
    expect(stubs[1]?.textContent).toContain("乙方.docx");

    const hidden = host.querySelectorAll('[data-preview-kind="word"][hidden]');
    expect(hidden).toHaveLength(1);

    const tabB = Array.from(host.querySelectorAll('[role="tab"]')).find((el) =>
      el.textContent?.includes("乙方.docx"),
    );
    expect(tabB).toBeTruthy();
    await act(async () => {
      tabB!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(setActiveTabId).toHaveBeenCalledWith(b.id);
  });

});
