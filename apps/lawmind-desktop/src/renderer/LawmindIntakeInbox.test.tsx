/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LawmindIntakeInbox } from "./LawmindIntakeInbox";

const items = [
  {
    schemaVersion: 1,
    id: "it-abc12345",
    channel: "email",
    externalKey: "email:acc-1:1",
    trust: "untrusted",
    receivedAt: "2026-10-26T01:00:00.000Z",
    recordedAt: "2026-10-26T01:00:05.000Z",
    from: { display: "王五 <wang@newclient.test>", address: "wang@newclient.test" },
    subject: "买卖合同纠纷咨询",
    text: "想委托律师起诉。",
    dmarc: "pass",
    attachments: [],
    status: "pending",
    resolution: { decision: "unmatched", candidates: [], resolvedAt: "2026-10-26T01:00:06.000Z" },
  },
];

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async (_base: string, path: string) => {
    if (path.startsWith("/api/intake/items?") || path === "/api/intake/items") {
      return { ok: true, items };
    }
    if (path.startsWith("/api/intake/items/")) {
      return { ok: true, item: items[0] };
    }
    if (path === "/api/matters/overviews") {
      return { ok: true, overviews: [{ matterId: "matter-a", displayName: "甲案" }] };
    }
    if (path === "/api/intake/matching-eval") {
      return {
        ok: true,
        report: {
          falseAttach: 0,
          recallAt1: 1,
          source: { labeled: 2, scanMayBeTruncated: false },
        },
      };
    }
    return { ok: false };
  }),
  apiSendJson: vi.fn(async () => ({ ok: true })),
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { apiSendJson } from "./api-client";

describe("LawmindIntakeInbox", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.mocked(apiSendJson).mockClear();
  });

  async function renderInbox(
    extra: {
      onOpenMatter?: (matterId: string) => void;
      matterLabelById?: Record<string, string>;
    } = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const onChanged = vi.fn();
    await act(async () => {
      root.render(
        <LawmindIntakeInbox
          apiBase="http://127.0.0.1:9"
          matterChoices={[]}
          {...(extra.matterLabelById ? { matterLabelById: extra.matterLabelById } : {})}
          {...(extra.onOpenMatter ? { onOpenMatter: extra.onOpenMatter } : {})}
          onChanged={onChanged}
          pollMs={0}
        />,
      );
    });
    // 列表 → 详情两跳都要等一次 microtask。
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return { onChanged };
  }

  it("shows pending intake items and opens the detail without any 签批 copy", async () => {
    await renderInbox();
    const inbox = host.querySelector('[data-testid="lm-intake-inbox"]');
    expect(inbox?.textContent).toContain("收件里还有 1 封没归案");
    expect(inbox?.textContent).toContain("买卖合同纠纷咨询");
    expect(inbox?.textContent).toContain("王五");
    expect(inbox?.textContent).toContain("判案评测：最近 2 条律师归案，误归 0，第一名命中 100%。");
    expect(inbox?.textContent).not.toContain("签批");
    expect(host.querySelector('[data-testid="lm-fleet-intake-detail"]')).toBeTruthy();
  });

  it("takes matter choices from the workspace overview, not only the desk list", async () => {
    await renderInbox();
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-fleet-intake-matter-select"]',
    );
    expect(select?.textContent).toContain("matter-a");
  });

  it("files the item with the selected matter and refreshes the caller", async () => {
    const { onChanged } = await renderInbox();
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-fleet-intake-matter-select"]',
    );
    await act(async () => {
      if (select) {
        select.value = "matter-a";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const attach = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-attach"]');
    expect(attach?.disabled).toBe(false);
    await act(async () => {
      attach?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/items/attach",
      "POST",
      expect.objectContaining({ itemId: "it-abc12345", matterId: "matter-a" }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("says so when the sender address already belongs to another party", async () => {
    await renderInbox();
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-fleet-intake-matter-select"]',
    );
    await act(async () => {
      if (select) {
        select.value = "matter-a";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const remember = host.querySelector<HTMLInputElement>(
      '[data-testid="lm-fleet-intake-remember-sender"]',
    );
    expect(remember).toBeTruthy();
    await act(async () => {
      remember!.click();
    });
    vi.mocked(apiSendJson).mockResolvedValueOnce({
      ok: true,
      rememberedSender: false,
      rememberSkippedParties: ["乙公司"],
    });
    const attach = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-attach"]');
    await act(async () => {
      attach?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const note = host.querySelector('[data-testid="lm-intake-attach-note"]');
    expect(note?.textContent).toContain("已经登记在乙公司名下");
    expect(note?.textContent).toContain("没有重复登记");
  });

  it("shows where the filed item went and can open that matter", async () => {
    const onOpenMatter = vi.fn();
    await renderInbox({ onOpenMatter, matterLabelById: { "matter-a": "甲案" } });
    const select = host.querySelector<HTMLSelectElement>(
      '[data-testid="lm-fleet-intake-matter-select"]',
    );
    await act(async () => {
      if (select) {
        select.value = "matter-a";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    vi.mocked(apiSendJson).mockResolvedValueOnce({
      ok: true,
      item: {
        filing: {
          matterId: "matter-a",
          materialized: [
            "cases/matter-a/materials/合同.pdf",
            "cases/matter-a/mail/inbox/邮件.eml",
          ],
        },
      },
    });
    const attach = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-attach"]');
    await act(async () => {
      attach?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const receipt = host.querySelector('[data-testid="lm-intake-filing-receipt"]');
    expect(receipt?.textContent).toContain("甲案");
    expect(receipt?.textContent).toContain("2 个文件");
    expect(receipt?.textContent).toContain("合同.pdf");
    const open = [...receipt!.querySelectorAll("button")].find(
      (button) => button.textContent === "打开案件",
    );
    act(() => {
      open!.click();
    });
    expect(onOpenMatter).toHaveBeenCalledWith("matter-a");
  });

  it("ignores an item instead of signing anything", async () => {
    await renderInbox();
    const ignore = host.querySelector<HTMLButtonElement>('[data-testid="lm-intake-ignore"]');
    await act(async () => {
      ignore?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/items/it-abc12345/ignore",
      "POST",
      {},
    );
  });
});
