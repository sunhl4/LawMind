/**
 * @vitest-environment jsdom
 *
 * 首跑演示案件名：稳定、律师友好、不带时间戳，且通过服务端 matterId 校验。
 * 单步首跑：选完身份即建「演示案件」并放默认交办；不再有文书/风格问卷。
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

describe("LawmindFirstRunDialog 单步首跑", () => {
  let host: HTMLDivElement;
  let root: Root;
  let createBodies: Array<{ matterId?: string }>;
  let learningPosts: unknown[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    createBodies = [];
    learningPosts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/matters/create")) {
          createBodies.push(jsonBody(init?.body));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/api/lawyer-profile/learning")) {
          learningPosts.push(jsonBody(init?.body));
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

  it("选完身份即创建稳定演示案件名并放默认交办，无时间戳、通过 matterId 校验", async () => {
    const onSeedReady = vi.fn();
    await act(async () => {
      root.render(
        <LawmindFirstRunDialog
          apiBase="http://127.0.0.1:8765"
          open
          onClose={vi.fn()}
          onSeedReady={onSeedReady}
        />,
      );
    });

    expect(host.textContent).not.toMatch(/行文风格|风险口径|对客语气|用推荐默认|买卖合同审查/);

    const roleCard = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("独立执业"),
    );
    expect(roleCard, "role card 独立执业").toBeTruthy();
    await act(async () => {
      roleCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createBodies.length).toBe(1);
    const matterId = createBodies[0]?.matterId ?? "";
    expect(matterId).toBe("演示案件");
    expect(matterId).not.toMatch(/\d{8,}/);
    expect(isValidMatterId(matterId)).toBe(true);
    expect(onSeedReady).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: "演示案件",
        seedPrompt: expect.stringContaining("待补充"),
      }),
    );
    expect(learningPosts).toEqual([]);
  });

  it("选合伙人身份放进审核默认交办", async () => {
    const onSeedReady = vi.fn();
    await act(async () => {
      root.render(
        <LawmindFirstRunDialog
          apiBase="http://127.0.0.1:8765"
          open
          onClose={vi.fn()}
          onSeedReady={onSeedReady}
        />,
      );
    });
    const roleCard = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("合伙人"),
    );
    expect(roleCard).toBeTruthy();
    await act(async () => {
      roleCard!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSeedReady).toHaveBeenCalledWith(
      expect.objectContaining({
        seedPrompt: expect.stringContaining("全要素审核"),
      }),
    );
  });

  it("exposes 跳过向导，直接开始 and creates 演示案件 without a seeded prompt", async () => {
    const onSeedReady = vi.fn();
    await act(async () => {
      root.render(
        <LawmindFirstRunDialog
          apiBase="http://127.0.0.1:8765"
          open
          onClose={vi.fn()}
          onSeedReady={onSeedReady}
        />,
      );
    });
    const skip = host.querySelector('[data-testid="lm-firstrun-skip-wizard"]') as HTMLButtonElement;
    expect(skip?.textContent).toContain("直接开始");
    await act(async () => {
      skip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(createBodies.length).toBe(1);
    expect(createBodies[0]?.matterId).toBe("演示案件");
    expect(onSeedReady).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: "演示案件",
        seedPrompt: "",
      }),
    );
  });
});
