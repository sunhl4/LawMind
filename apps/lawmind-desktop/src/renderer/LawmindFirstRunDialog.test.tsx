/**
 * @vitest-environment jsdom
 *
 * 首跑演示案件名：稳定、律师友好、不带时间戳，且通过服务端 matterId 校验。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidMatterId } from "../../../../src/lawmind/cases/matter-id.ts";
import { LawmindFirstRunDialog } from "./LawmindFirstRunDialog";

function jsonBody(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

const SPEC = {
  type: "contract.review",
  displayName: "买卖合同审查",
  description: "买卖合同审查交付",
  defaultOutput: "docx",
  source: "builtin",
};

describe("LawmindFirstRunDialog 演示案件名", () => {
  let host: HTMLDivElement;
  let root: Root;
  let createBodies: Array<{ matterId?: string }>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    createBodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/deliverables/specs")) {
          return new Response(JSON.stringify({ ok: true, specs: [SPEC] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/api/matters/create")) {
          createBodies.push(jsonBody(init?.body));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("创建的演示案件名稳定、无时间戳、通过 matterId 校验", async () => {
    await act(async () => {
      root.render(
        <LawmindFirstRunDialog
          apiBase="http://127.0.0.1:8765"
          open
          onClose={vi.fn()}
          onSeedReady={vi.fn()}
        />,
      );
    });

    const clickByText = async (text: string) => {
      const el = Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent?.includes(text),
      );
      expect(el, `button containing ${text}`).toBeTruthy();
      await act(async () => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };

    await clickByText("独立执业");
    await clickByText("用推荐默认，跳过习惯");
    await clickByText("买卖合同审查");
    const box = host.querySelector('[data-testid="lm-firstrun-create-matter"]') as HTMLInputElement | null;
    expect(box).toBeTruthy();
    await act(async () => {
      box!.click();
    });
    await clickByText("建案件并开始交办");

    expect(createBodies.length).toBe(1);
    const matterId = createBodies[0]?.matterId ?? "";
    expect(matterId).toBe("演示案件-买卖合同审查");
    expect(matterId).not.toMatch(/\d{8,}/);
    expect(isValidMatterId(matterId)).toBe(true);
  });
});
