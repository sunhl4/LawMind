/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { LawmindMatterBrief } from "./LawmindMatterBrief";

vi.mock("./api-client", () => ({
  apiGetJson: vi.fn(async () => ({ ok: false, reason: "model_unconfigured" })),
}));

import { apiGetJson } from "./api-client";

describe("LawmindMatterBrief", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    try {
      localStorage.removeItem("lawmind.matterBrief.m1");
    } catch {
      /* ignore */
    }
    vi.mocked(apiGetJson).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not render when brief API returns ok false", async () => {
    vi.mocked(apiGetJson).mockResolvedValue({ ok: false, reason: "model_unconfigured" });
    await act(async () => {
      root.render(<LawmindMatterBrief apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-matter-brief"]')).toBeNull();
  });

  it("renders cached brief text from localStorage", async () => {
    try {
      localStorage.setItem(
        "lawmind.matterBrief.m1",
        JSON.stringify({ text: "缓存的一案摘要。", hash: "abc", at: "2026-01-01" }),
      );
    } catch {
      // Some jsdom setups lack full localStorage; skip cache assertion path.
      return;
    }
    vi.mocked(apiGetJson).mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      root.render(<LawmindMatterBrief apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    expect(host.textContent).toContain("缓存的一案摘要");
  });

  it("keeps cached brief when refresh fails", async () => {
    try {
      localStorage.setItem(
        "lawmind.matterBrief.m1",
        JSON.stringify({ text: "缓存的一案摘要。", hash: "abc", at: "2026-01-01" }),
      );
    } catch {
      return;
    }
    vi.mocked(apiGetJson).mockResolvedValue({ ok: false, reason: "model_failed" });
    await act(async () => {
      root.render(<LawmindMatterBrief apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("缓存的一案摘要");
  });
});
