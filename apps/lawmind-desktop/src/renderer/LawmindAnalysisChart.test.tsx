/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindAnalysisChart } from "./LawmindAnalysisChart";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";
import { shouldShowSpreadsheetHintBar } from "./LawmindSpreadsheetHintBar";

describe("LawmindAnalysisChart", () => {
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

  it("renders a bar chart from spec JSON", async () => {
    const spec = {
      title: "金额",
      type: "bar",
      categories: ["一", "二"],
      series: [{ name: "A", values: [3, 5] }],
    };
    await act(async () => {
      root.render(<LawmindAnalysisChart specText={JSON.stringify(spec)} />);
    });
    expect(host.querySelector("[data-testid='lm-analysis-chart']")).toBeTruthy();
    expect(host.querySelector("svg.lm-chart-svg")).toBeTruthy();
    expect(host.textContent).toContain("金额");
  });

  it("parses lm-chart fences in assistant markdown", async () => {
    const text = [
      "如下图。",
      "```lm-chart",
      JSON.stringify({
        title: "围栏图",
        type: "line",
        categories: ["a"],
        series: [{ name: "s", values: [1] }],
      }),
      "```",
    ].join("\n");
    await act(async () => {
      root.render(<div>{renderLegalMarkdown(text)}</div>);
    });
    expect(host.querySelector("[data-testid='lm-analysis-chart']")).toBeTruthy();
    expect(host.textContent).toContain("围栏图");
  });
});

describe("spreadsheet hint bar", () => {
  it("shows only when an xlsx is pinned", () => {
    expect(shouldShowSpreadsheetHintBar([{ relPath: "a.docx" }])).toBe(false);
    expect(shouldShowSpreadsheetHintBar([{ relPath: "费用.xlsx" }])).toBe(true);
  });
});
