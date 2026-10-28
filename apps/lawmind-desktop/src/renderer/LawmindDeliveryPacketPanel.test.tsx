/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(),
  apiSendJson: vi.fn(),
  fetchApi: vi.fn(),
  errorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
}));

import { apiGetJson, apiSendJson, fetchApi } from "./api-client";
import { LawmindDeliveryPacketPanel } from "./LawmindDeliveryPacketPanel";

const packet = {
  schemaVersion: 1 as const,
  packetId: "pkt_1",
  matterId: "m1",
  title: "甲公司 · 客户包",
  audience: "client" as const,
  sections: [
    {
      sectionId: "s1",
      kind: "opinion" as const,
      title: "法律意见",
      documents: [
        {
          docId: "d1",
          path: "cases/m1/opinion.md",
          title: "意见书",
          required: true,
        },
      ],
    },
  ],
  createdAt: "2026-10-27T04:00:00.000Z",
  updatedAt: "2026-10-27T04:00:00.000Z",
};

function view(over: { blockers?: string[]; warnings?: string[]; included?: boolean } = {}) {
  return {
    packet,
    manifest: {
      audience: "client" as const,
      packetHash: "a".repeat(32),
      blockers: over.blockers ?? [],
      warnings: over.warnings ?? [],
      files: [
        {
          order: 1,
          sectionId: "s1",
          docId: "d1",
          path: "cases/m1/opinion.md",
          title: "意见书",
          sha256: "b".repeat(64),
          bytes: 12,
        },
      ],
      sections: [
        {
          sectionId: "s1",
          kind: "opinion" as const,
          title: "法律意见",
          documents: [
            {
              docId: "d1",
              path: "cases/m1/opinion.md",
              title: "意见书",
              required: true,
              included: over.included ?? true,
              sha256: "b".repeat(64),
              bytes: 12,
            },
          ],
        },
      ],
      readiness: (over.blockers?.length ?? 0) > 0 ? ("blocked" as const) : ("ready" as const),
    },
  };
}

describe("LawmindDeliveryPacketPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    vi.mocked(apiGetJson).mockReset();
    vi.mocked(apiSendJson).mockReset();
    vi.mocked(fetchApi).mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:packet"),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<LawmindDeliveryPacketPanel apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("offers to seed a packet when the matter has none", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({ ok: true, packets: [] });
    vi.mocked(apiSendJson).mockResolvedValue({ ok: true });
    await render();
    expect(host.textContent).toContain("还没有交付包");
    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("从成果物生成"),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/matters/m1/delivery-packets",
      "POST",
      { action: "seed", audience: "client" },
    );
  });

  it("shows sections, blockers and disables ZIP when the packet is blocked", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ok: true,
      packets: [view({ blockers: ["缺少必需文件：cases/m1/opinion.md"] })],
    });
    await render();
    expect(host.textContent).toContain("法律意见");
    expect(host.textContent).toContain("缺少必需文件");
    expect(host.textContent).toContain("不可交付");
    const zip = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("导出 ZIP"),
    );
    expect(zip?.disabled).toBe(true);
  });

  it("toggling a document excludes it from the current audience and saves the packet", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({ ok: true, packets: [view()] });
    vi.mocked(apiSendJson).mockResolvedValue({ ok: true });
    await render();
    const checkbox = host.querySelector(
      'input[aria-label="移出意见书"]',
    ) as HTMLInputElement | null;
    expect(checkbox?.checked).toBe(true);
    await act(async () => {
      checkbox!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledTimes(1);
    const [, , method, body] = vi.mocked(apiSendJson).mock.calls[0];
    expect(method).toBe("POST");
    const saved = body as {
      action: string;
      packet: { sections: Array<{ documents: Array<{ audiences?: string[] }> }> };
    };
    expect(saved.action).toBe("save");
    expect(saved.packet.sections[0]?.documents[0]?.audiences).toEqual([
      "court",
      "opposing",
      "internal",
    ]);
  });

  it("downloads the ZIP when the packet is ready", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({ ok: true, packets: [view()] });
    vi.mocked(fetchApi).mockResolvedValue(
      new Response("PK", {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": "attachment; filename*=UTF-8''%E4%BA%A4%E4%BB%98%E5%8C%85.zip",
        },
      }),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render();
    const zip = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("导出 ZIP"),
    ) as HTMLButtonElement;
    await act(async () => {
      zip.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchApi).toHaveBeenCalled();
    const url = vi.mocked(fetchApi).mock.calls[0]?.[0] as string;
    expect(url).toContain("format=zip");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("enables merged PDF only for all-PDF packets and requests the PDF format", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({
      ok: true,
      packets: [
        {
          packet,
          manifest: {
            ...view().manifest,
            files: [
              {
                order: 1,
                sectionId: "s1",
                docId: "d1",
                path: "cases/m1/opinion.pdf",
                title: "意见书",
                sha256: "c".repeat(64),
                bytes: 12,
              },
            ],
            sections: [
              {
                sectionId: "s1",
                kind: "opinion" as const,
                title: "法律意见",
                documents: [
                  {
                    docId: "d1",
                    path: "cases/m1/opinion.pdf",
                    title: "意见书",
                    required: true,
                    included: true,
                    sha256: "c".repeat(64),
                    bytes: 12,
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    vi.mocked(fetchApi).mockResolvedValue(
      new Response("%PDF-1.7", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": "attachment; filename*=UTF-8''%E4%BA%A4%E4%BB%98%E5%8C%85.pdf",
        },
      }),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await render();
    const pdfButton = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("导出合并 PDF"),
    ) as HTMLButtonElement;
    expect(pdfButton.disabled).toBe(false);
    await act(async () => {
      pdfButton.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const url = vi.mocked(fetchApi).mock.calls[0]?.[0] as string;
    expect(url).toContain("format=merged_pdf");
    clickSpy.mockRestore();
  });

  it("persists the Bates numbering choice without changing the packet hash", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({ ok: true, packets: [view()] });
    vi.mocked(apiSendJson).mockResolvedValue({ ok: true });
    await render();
    const label = [...host.querySelectorAll("label")].find((row) =>
      row.textContent?.includes("Bates 页码"),
    );
    const box = label?.querySelector("input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => {
      box.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledTimes(1);
    const body = vi.mocked(apiSendJson).mock.calls[0]?.[3] as {
      action: string;
      packet: { output?: { format?: string; bates?: { prefix?: string; start?: number } } };
    };
    expect(body.action).toBe("save");
    expect(body.packet.output?.format).toBe("merged_pdf");
    expect(body.packet.output?.bates).toMatchObject({ prefix: "LM", start: 1 });
  });
});
