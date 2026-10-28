/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(),
}));

import { apiGetJson } from "./api-client";
import { LawmindMatterArtifactPanel } from "./LawmindMatterArtifactPanel";

const timeline = {
  schemaVersion: 1,
  kind: "case-timeline",
  events: [
    {
      id: "e1",
      date: "2026-03-01",
      sortKey: "20260301",
      title: "立案",
      evidence: [{ filePath: "cases/m/materials/起诉状.pdf", lineRef: "P1", quote: "请求判令" }],
    },
    {
      id: "e2",
      date: "2026-04-11",
      sortKey: "20260411",
      title: "开庭",
      evidence: [],
    },
  ],
};

const mindmap = {
  schemaVersion: 1,
  kind: "case-mindmap",
  root: {
    id: "root",
    label: "租赁纠纷",
    kind: "issue",
    children: [
      { id: "a", label: "合同效力", children: [{ id: "a1", label: "签章真实性", children: [] }] },
      { id: "b", label: "租金标准", kind: "party", children: [] },
    ],
  },
};

const okResponse = {
  ok: true,
  artifacts: {
    "case-timeline": { status: "ok", artifact: timeline, issues: [] },
    "case-chronology": { status: "missing" },
    "case-mindmap": { status: "ok", artifact: mindmap, issues: [] },
  },
};

describe("LawmindMatterArtifactPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(apiGetJson).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(matterId = "m1") {
    await act(async () => {
      root.render(<LawmindMatterArtifactPanel apiBase="http://127.0.0.1:9" matterId={matterId} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("renders timeline rows and flags items without evidence", async () => {
    vi.mocked(apiGetJson).mockResolvedValue(okResponse);
    await render();
    const panel = host.querySelector('[data-testid="lm-matter-artifacts"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("案件成果");
    expect(host.textContent).toContain("立案");
    expect(host.textContent).toContain("开庭");
    expect(host.textContent).toContain("2026");
    // 一条有锚、一条没有 → 提示待补出处
    expect(host.textContent).toContain("1 项待补出处");
    expect(host.textContent).toContain("未附出处，需补锚");
  });

  it("opens the material when an evidence chip is clicked", async () => {
    vi.mocked(apiGetJson).mockResolvedValue(okResponse);
    const onOpenEvidence = vi.fn();
    await act(async () => {
      root.render(
        <LawmindMatterArtifactPanel
          apiBase="http://127.0.0.1:9"
          matterId="m1"
          onOpenEvidence={onOpenEvidence}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const chip = host.querySelector<HTMLButtonElement>(
      "button.lm-matter-artifact-evidence-chip.is-link",
    );
    expect(chip).not.toBeNull();
    await act(async () => {
      chip?.click();
    });
    expect(onOpenEvidence).toHaveBeenCalledWith("cases/m/materials/起诉状.pdf", "P1");
  });

  it("renders mindmap nodes and keeps an accessible text outline", async () => {
    vi.mocked(apiGetJson).mockResolvedValue(okResponse);
    await render();
    const nodes = host.querySelectorAll('[data-testid="lm-matter-mindmap-node"]');
    expect(nodes.length).toBe(4);
    const svg = host.querySelector("svg.lm-matter-mindmap");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toContain("共 4 个节点");
    expect(host.textContent).toContain("文本大纲");
  });

  it("shows the empty state for missing artifacts and a broken-file note for invalid ones", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ok: true,
      artifacts: {
        "case-timeline": { status: "missing" },
        "case-chronology": {
          status: "invalid",
          issues: [{ path: "/", reasonZh: "JSON 解析失败（文件损坏或未保存完整）" }],
        },
        "case-mindmap": { status: "missing" },
      },
    });
    await render();
    expect(host.textContent).toContain("未创建");
    expect(host.textContent).toContain("文件损坏");
    expect(host.textContent).toContain("JSON 解析失败");
  });

  it("surfaces a fetch failure without throwing", async () => {
    vi.mocked(apiGetJson).mockRejectedValue(new Error("boom"));
    await render();
    expect(host.textContent).toContain("读取失败：boom");
  });

  it("does not fetch without a matter id", async () => {
    await render("");
    expect(apiGetJson).not.toHaveBeenCalled();
  });
});
