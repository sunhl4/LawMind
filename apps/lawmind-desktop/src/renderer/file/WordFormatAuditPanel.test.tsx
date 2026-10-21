/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormatAuditReport } from "../../../../../src/lawmind/drafts/document-format-audit.ts";

const apiSendJson = vi.fn();

vi.mock("../api-client", () => ({
  apiSendJson: (...args: unknown[]) => apiSendJson(...args),
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { WordFormatAuditPanel } from "./WordFormatAuditPanel";

function importedReport(): FormatAuditReport {
  return {
    mode: "imported",
    standard: {
      id: "document-self",
      labelZh: "跟随原文格式",
      provisional: false,
      requestedByLawyer: false,
      noticeZh: "外来件以文件自身的主流格式为准；只有律师明确要求时才整体调整。",
    },
    profile: {
      sampleCount: 12,
      fontFamily: "宋体",
      fontSizePx: 16,
      fontSizePt: 12,
      share: 0.93,
      labelZh: "宋体　小四　12pt",
    },
    findings: [
      {
        code: "imported.font",
        severity: "error",
        messageZh: "LawMind 写入的段落字体跟原文不一致",
        paragraphIndex: 2,
        actual: "仿宋",
        expected: "宋体",
        basisZh: "跟随原文主流格式",
      },
      {
        code: "imported.indent",
        severity: "warning",
        messageZh: "LawMind 写入的段落缩进跟原文不一致",
        paragraphIndex: 3,
        actual: "0.00 字",
        expected: "2.00 字",
        basisZh: "跟随原文主流格式",
      },
    ],
    unchecked: ["页面、页边距、行距：外来件保持原样，不按公文模板检查"],
    omittedFindings: 0,
    counts: { error: 1, warning: 1, info: 0 },
    ok: false,
    summaryZh: "格式体检：1 处不符合，1 处需确认，1 项未检查。",
  };
}

function gbReport(): FormatAuditReport {
  return {
    ...importedReport(),
    mode: "from-scratch",
    standard: {
      id: "gb-t-9704-2012",
      labelZh: "党政机关公文格式 GB/T 9704-2012（草案）",
      provisional: true,
      requestedByLawyer: false,
      noticeZh: "【待律师确认】当前按 GB/T 9704-2012 草案检查。",
      todoMarker: "TODO(lawyer-format-standard)",
    },
    profile: { sampleCount: 0, share: 0, labelZh: "无法识别正文主流格式" },
    findings: [],
    counts: { error: 0, warning: 0, info: 0 },
    ok: true,
    summaryZh: "格式体检：已检查项未见问题，2 项未检查。",
  };
}

describe("WordFormatAuditPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    apiSendJson.mockReset();
  });

  async function renderPanel(onJumpToParagraph?: (index: number) => void) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <WordFormatAuditPanel
          apiBase="http://127.0.0.1:9"
          root="workspace"
          relPath="材料/合同.docx"
          onClose={() => undefined}
          {...(onJumpToParagraph ? { onJumpToParagraph } : {})}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return { host, root };
  }

  it("starts with 跟随原文 so it never imposes the template by default", async () => {
    apiSendJson.mockResolvedValue({ ok: true, report: importedReport() });
    const { host, root } = await renderPanel();
    const imported = host.querySelector('[data-testid="lm-format-mode-imported"]');
    expect(imported?.getAttribute("aria-pressed")).toBe("true");
    const call = apiSendJson.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[1]).toBe("/api/documents/format-audit");
    const auditOpts = call[3] as { mode?: string } | undefined;
    expect(auditOpts?.mode).toBe("imported");
    expect(host.textContent).toContain("跟随原文");
    expect(host.textContent).toContain("宋体");
    expect(host.textContent).toContain("一致 93%");
    expect(host.textContent).toContain("没检查（不算通过）");
    await act(async () => root.unmount());
  });

  it("shows findings as a clickable list that jumps to the paragraph", async () => {
    apiSendJson.mockResolvedValue({ ok: true, report: importedReport() });
    const jumps: number[] = [];
    const { host, root } = await renderPanel((index) => jumps.push(index));
    const items = [...host.querySelectorAll(".lm-word-format-audit-list li")];
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("data-severity")).toBe("error");
    expect(items[0]?.textContent).toContain("第 3 段");
    expect(items[0]?.textContent).toContain("现：仿宋");
    expect(items[0]?.textContent).toContain("应：宋体");
    const button = items[0]?.querySelector("button");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(jumps).toEqual([2]);
    await act(async () => root.unmount());
  });

  it("keeps the provisional GB banner visible when drafting from scratch", async () => {
    apiSendJson.mockResolvedValueOnce({ ok: true, report: importedReport() });
    const { host, root } = await renderPanel();
    apiSendJson.mockResolvedValueOnce({ ok: true, report: gbReport() });
    const mode = host.querySelector('[data-testid="lm-format-mode-from-scratch"]');
    await act(async () => {
      mode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const banner = host.querySelector(".lm-word-format-audit-banner");
    expect(banner?.textContent).toContain("待律师确认");
    expect(banner?.getAttribute("data-provisional")).toBe("true");
    expect(host.textContent).toContain("已检查的项目没发现问题");
    expect(apiSendJson.mock.calls[1]?.[3]).toMatchObject({ mode: "from-scratch" });
    await act(async () => root.unmount());
  });

  it("offers the copy fix only when there is something A-layer to fix", async () => {
    apiSendJson.mockResolvedValue({ ok: true, report: importedReport() });
    const { host, root } = await renderPanel();
    expect(host.querySelector('[data-testid="lm-format-fix"]')).toBeTruthy();
    await act(async () => root.unmount());

    // 只有版面类问题（不可自动改）：不给按钮，避免"看着能修其实修不了"
    const onlyLayout: FormatAuditReport = {
      ...importedReport(),
      findings: [
        {
          code: "imported.unstable",
          severity: "warning",
          messageZh: "文件自身格式不统一",
          basisZh: "跟随原文",
        },
      ],
      counts: { error: 0, warning: 1, info: 0 },
      ok: true,
    };
    apiSendJson.mockReset();
    apiSendJson.mockResolvedValue({ ok: true, report: onlyLayout });
    const second = await renderPanel();
    expect(second.host.querySelector('[data-testid="lm-format-fix"]')).toBeNull();
    await act(async () => second.root.unmount());
  });

  it("reports a readable error instead of an empty success", async () => {
    apiSendJson.mockRejectedValueOnce(new Error("网络断了"));
    const { host, root } = await renderPanel();
    expect(host.querySelector("[role='alert']")?.textContent).toContain("体检没跑起来");
    expect(host.querySelector(".lm-word-format-audit-summary")).toBeNull();
    await act(async () => root.unmount());
  });
});
