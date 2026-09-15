/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
