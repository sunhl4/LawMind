/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";

describe("LawmindMemorySourcesPanel", () => {
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

  it("frames the table as archive health, not per-answer citations", async () => {
    await act(async () => {
      root.render(
        <LawmindMemorySourcesPanel
          defaultOpen
          layers={[
            {
              id: "lawyer_profile",
              label: "律师档案",
              relativePath: "LAWYER_PROFILE.md",
              exists: false,
              charCount: 0,
              inAgentSystemPrompt: true,
            },
            {
              id: "yesterday_log",
              label: "昨日工作日志",
              relativePath: "memory/2026-09-27.md",
              exists: true,
              charCount: 12,
              inAgentSystemPrompt: false,
            },
          ]}
        />,
      );
    });

    expect(host.textContent).toContain("这些档案在不在");
    expect(host.textContent).toContain("不是某条回答的引用列表");
    expect(host.textContent).toContain("未建（本可进主说明）");
    expect(host.textContent).toContain("仅检索/引擎");
    expect(host.textContent).not.toContain("本回答引用");
    expect(host.textContent).not.toContain("已写入说明");
    expect(host.textContent).not.toContain("类材料");
  });
});
