/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGetJson: vi.fn(),
  apiSendJson: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiGetJson: (...args: unknown[]) => mocks.apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => mocks.apiSendJson(...args),
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));

import { LawmindMailAccountsSection } from "./LawmindMailAccountsSection";

const accounts = [
  {
    id: "acc-intake",
    label: "收案箱",
    provider: "gmail",
    providerLabel: "Gmail",
    email: "intake@firm.test",
    authKind: "app_password",
    intakeInbox: true,
    enabled: true,
    hasSecret: true,
  },
  {
    id: "acc-matter",
    label: "办案箱",
    provider: "gmail",
    providerLabel: "Gmail",
    email: "matter@firm.test",
    authKind: "app_password",
    matterId: "matter-a",
    enabled: true,
    hasSecret: true,
  },
];

async function flush(host: HTMLElement): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    if (host.textContent?.includes("收案箱") && host.textContent.includes("办案箱")) {
      return;
    }
  }
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    if (host.textContent?.includes(text)) {
      return;
    }
  }
}

function rowButton(host: HTMLElement, rowLabel: string, label: string): HTMLButtonElement {
  const row = [...host.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(rowLabel),
  );
  const button = [...(row?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`找不到「${rowLabel}」行里的「${label}」按钮`);
  }
  return button;
}

describe("LawmindMailAccountsSection per-account sync", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.apiGetJson.mockReset();
    mocks.apiSendJson.mockReset();
    mocks.apiGetJson.mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/mail/providers") {
        return { providers: [] };
      }
      if (path === "/api/mail/accounts") {
        return { accounts };
      }
      return {};
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("routes an intake account's manual sync through the intake tick with its own accountId", async () => {
    mocks.apiSendJson.mockResolvedValue({
      ok: true,
      result: {
        mail: [{ ok: true, accountId: "acc-intake", fetched: 1, recorded: 1, autoAttached: 0 }],
      },
    });

    await act(async () => {
      root.render(<LawmindMailAccountsSection apiBase="http://127.0.0.1:9" />);
    });
    await flush(host);

    rowButton(host, "收案箱", "同步").click();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/intake/sync",
      "POST",
      { accountId: "acc-intake" },
    );
    await waitForText(host, "新收 1 封");
    expect(host.textContent).toContain("新收 1 封");
  });

  it("keeps a matter-bound account on the per-matter sync route", async () => {
    mocks.apiSendJson.mockResolvedValue({
      ok: true,
      fetched: 2,
      written: 2,
      filteredOut: 0,
      watchMode: "all",
    });

    await act(async () => {
      root.render(<LawmindMailAccountsSection apiBase="http://127.0.0.1:9" />);
    });
    await flush(host);

    rowButton(host, "办案箱", "同步").click();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.apiSendJson).toHaveBeenCalledWith(
      "http://127.0.0.1:9",
      "/api/mail/accounts/acc-matter/sync",
      "POST",
      { matterId: "matter-a" },
    );
  });

  it("shows the intake sync failure instead of claiming success", async () => {
    mocks.apiSendJson.mockResolvedValue({
      ok: false,
      result: {
        mail: [
          {
            ok: false,
            accountId: "acc-intake",
            error: "sync_failed",
            hint: "IMAP 认证失败",
          },
        ],
      },
    });

    await act(async () => {
      root.render(<LawmindMailAccountsSection apiBase="http://127.0.0.1:9" />);
    });
    await flush(host);

    rowButton(host, "收案箱", "同步").click();
    await act(async () => {
      await Promise.resolve();
    });

    await waitForText(host, "IMAP 认证失败");
    expect(host.textContent).toContain("IMAP 认证失败");
    expect(host.textContent).not.toContain("已同步收案邮箱");
  });
});
