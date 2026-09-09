/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsPracticePlaybook } from "./LawmindSettingsPracticePlaybook";

function jsonBody(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

describe("LawmindSettingsPracticePlaybook", () => {
  let host: HTMLDivElement;
  let root: Root;
  let posts: unknown[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/workspace/practice-playbook") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify({
              ok: true,
              playbook: {
                source: "default",
                stanceDefault: "protect_instructing",
                disputeForum: "写明有管辖权的人民法院或仲裁",
                neverAccept: ["无限责任"],
                notes: "",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/workspace/practice-playbook") && init?.method === "POST") {
          posts.push(jsonBody(init.body));
          return new Response(
            JSON.stringify({
              ok: true,
              playbook: {
                source: "workspace",
                stanceDefault: "our_paper",
                disputeForum: "写明有管辖权的人民法院或仲裁",
                neverAccept: ["无限责任"],
                notes: "",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
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

  it("loads defaults and saves later-task-only copy", async () => {
    await act(async () => {
      root.render(<LawmindSettingsPracticePlaybook apiBase="http://127.0.0.1:8765" />);
    });
    await act(async () => {});
    expect(host.textContent).toContain("改完只影响之后的办件");
    const stance = host.querySelector(
      '[data-testid="lm-practice-playbook-stance"]',
    ) as HTMLSelectElement;
    expect(stance.value).toBe("protect_instructing");
    await act(async () => {
      (host.querySelector('[data-testid="lm-practice-playbook-save"]') as HTMLButtonElement).click();
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ stanceDefault: "protect_instructing" });
    expect(host.textContent).toContain("只影响之后的办件");
  });
});
