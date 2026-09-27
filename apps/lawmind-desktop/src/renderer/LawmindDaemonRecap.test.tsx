/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindDaemonRecap } from "./LawmindDaemonRecap";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("LawmindDaemonRecap", () => {
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
    vi.unstubAllGlobals();
  });

  it("stays hidden when the daemon has nothing to report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, daemon: { running: true, recap: null } })),
    );
    await act(async () => {
      root.render(<LawmindDaemonRecap apiBase="http://127.0.0.1:9" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-fleet-daemon-recap"]')).toBeNull();
  });

  it("shows the server recap on the desk the lawyer actually opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          daemon: {
            supervisionGaveUp: true,
            recap: {
              headline: "后台办件已停止重试",
              details: ["连续失败后不再自动拉起。"],
            },
          },
        }),
      ),
    );
    await act(async () => {
      root.render(<LawmindDaemonRecap apiBase="http://127.0.0.1:9" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const recap = host.querySelector('[data-testid="lm-fleet-daemon-recap"]');
    expect(recap?.textContent).toContain("后台办件已停止重试");
    expect(recap?.className).toContain("lm-callout-danger");
    expect(recap?.getAttribute("role")).toBe("status");
  });
});
