/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsUserStandards } from "./LawmindSettingsUserStandards";

function jsonBody(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

describe("LawmindSettingsUserStandards", () => {
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
        if (url.includes("/api/workspace/standards") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify({
              ok: true,
              standards: [
                {
                  id: "builtin-contract-review",
                  title: "通用合同审查口径",
                  kind: "contract_review",
                  enabled: true,
                  source: "builtin",
                  items: [{ text: "核对争议解决", tone: "check" }],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/workspace/cause-lexicon") && (!init?.method || init.method === "GET")) {
          return new Response(
            JSON.stringify({ ok: true, lexicon: { causes: ["买卖合同纠纷"] } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/api/workspace/standards") && init?.method === "POST") {
          posts.push(jsonBody(init.body));
          return new Response(JSON.stringify({ ok: true, standard: { id: "std-1" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes("/api/workspace/cause-lexicon") && init?.method === "POST") {
          posts.push(jsonBody(init.body));
          return new Response(JSON.stringify({ ok: true, lexicon: { causes: ["买卖合同纠纷"] } }), {
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

  it("loads standards and saves a lawyer-authored entry", async () => {
    await act(async () => {
      root.render(<LawmindSettingsUserStandards apiBase="http://127.0.0.1:8765" />);
    });
    await act(async () => {});
    expect(host.textContent).toContain("审查标准");
    expect(host.textContent).toContain("通用合同审查口径");
    expect(host.textContent).toContain("案由词表");
    await act(async () => {
      const btn = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes("停用"));
      btn?.click();
    });
    expect(posts.some((p) => p && typeof p === "object" && (p as { enabled?: boolean }).enabled === false)).toBe(
      true,
    );
  });
});
