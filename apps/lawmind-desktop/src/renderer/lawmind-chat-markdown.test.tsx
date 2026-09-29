/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAWMIND_OPEN_WORKSPACE_FILE_EVENT } from "./lawmind-workspace-file-open";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";

describe("renderLegalMarkdown tables and math", () => {
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

  it("renders a comparison table as a real HTML table", async () => {
    const text = [
      "对照如下：",
      "",
      "| 条款 | 我方 | 对方 |",
      "| --- | --- | --- |",
      "| 违约金 | **20%** | 30% |",
      "| 管辖 | 上海 | 北京 |",
    ].join("\n");
    await act(async () => {
      root.render(<div>{renderLegalMarkdown(text)}</div>);
    });
    const table = host.querySelector("[data-testid='lm-md-table']");
    expect(table).toBeTruthy();
    expect(table?.tagName).toBe("TABLE");
    expect(host.querySelectorAll("th")).toHaveLength(3);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.querySelector("strong")?.textContent).toBe("20%");
    expect(host.textContent).toContain("对照如下");
  });

  it("renders GitHub tables that omit the leading pipe", async () => {
    const text = ["项目 | 公式 | 结果", ":--- | :---: | ---:", "利息 | $I=Prt$ | 12"].join("\n");
    await act(async () => {
      root.render(<div>{renderLegalMarkdown(text)}</div>);
    });
    expect(host.querySelector("[data-testid='lm-md-table']")).toBeTruthy();
    expect(host.querySelector("[data-testid='lm-md-math']")).toBeTruthy();
    expect(host.querySelector(".katex")).toBeTruthy();
  });

  it("renders Codex-style inline and display LaTeX", async () => {
    const text = [
      "日利率为 \\(\\frac{LPR}{365}\\)。",
      "",
      "$$",
      "I = P \\times r \\times t",
      "$$",
    ].join("\n");
    await act(async () => {
      root.render(<div>{renderLegalMarkdown(text)}</div>);
    });
    const math = host.querySelectorAll("[data-testid='lm-md-math']");
    expect(math.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelectorAll(".katex-html").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector("math")).toBeTruthy();
    expect(host.querySelector("[data-display='true']")).toBeTruthy();
  });

  it("does not turn fenced pipes into a table", async () => {
    const text = ["```", "| 条款 | 值 |", "| --- | --- |", "| A | 1 |", "```"].join("\n");
    await act(async () => {
      root.render(<div>{renderLegalMarkdown(text)}</div>);
    });
    expect(host.querySelector("[data-testid='lm-md-table']")).toBeNull();
    expect(host.querySelector("pre.lm-md-pre")?.textContent).toContain("| 条款 | 值 |");
  });

  it("renders a clickable lm-session cite", async () => {
    await act(async () => {
      root.render(<div>{renderLegalMarkdown("见 [采购合同审查](lm-session:sess-1)。")}</div>);
    });
    const link = host.querySelector("[data-testid='lm-md-session-link']");
    expect(link?.tagName).toBe("BUTTON");
    expect(link?.textContent).toBe("采购合同审查");
    expect(host.textContent).not.toContain("lm-session:");
  });

  it("renders draft, web, file, and canvas jumps", async () => {
    const opened: string[] = [];
    const drafts: string[] = [];
    const files: Array<{ relPath?: string; line?: number }> = [];
    const previous = window.open;
    window.open = ((url: string) => {
      opened.push(url);
      return null;
    }) as typeof window.open;
    const onFile = (ev: Event) => {
      const detail = (ev as CustomEvent<{ relPath?: string; line?: number }>).detail;
      files.push({
        relPath: detail?.relPath,
        ...(detail?.line ? { line: detail.line } : {}),
      });
    };
    window.addEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    await act(async () => {
      root.render(
        <div>
          {renderLegalMarkdown(
            "稿 [派遣协议](lm-draft:task-9)。意见见 [《劳动合同法》第63条](https://flk.npc.gov.cn/a)。另见 [裁判文书](https://wenshu.court.gov.cn/a) 和 [费用核对](canvas/核对.canvas.tsx)。文件在 cases/m/派遣协议.docx:8。内网 [后台](https://127.0.0.1/a) 不能点。`notes/secret.docx` 在代码里。",
            { onOpenDraft: (taskId) => drafts.push(taskId) },
          )}
        </div>,
      );
    });
    const draft = host.querySelector("[data-testid='lm-md-draft-link']");
    const webs = [...host.querySelectorAll("[data-testid='lm-md-web-link']")];
    const canvas = host.querySelector("[data-testid='lm-md-canvas-link']");
    const file = host.querySelector("[data-testid='lm-md-file-link']");
    expect(draft?.textContent).toBe("派遣协议");
    expect(webs.map((node) => node.textContent)).toEqual([
      "《劳动合同法》第63条",
      "裁判文书",
    ]);
    expect(canvas?.textContent).toBe("费用核对");
    expect(file?.textContent).toBe("cases/m/派遣协议.docx:8");
    expect(host.textContent).toContain("后台");
    expect(host.textContent).not.toContain("127.0.0.1");
    expect(host.textContent).not.toContain("lm-draft:");
    expect(host.querySelector("code")?.textContent).toBe("notes/secret.docx");
    await act(async () => {
      draft?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      webs[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      canvas?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      file?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    window.removeEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    window.open = previous;
    expect(drafts).toEqual(["task-9"]);
    expect(opened.some((url) => url.includes("flk.npc.gov.cn"))).toBe(true);
    expect(files).toEqual([
      { relPath: "canvas/核对.canvas.tsx" },
      { relPath: "cases/m/派遣协议.docx", line: 8 },
    ]);
  });
});
