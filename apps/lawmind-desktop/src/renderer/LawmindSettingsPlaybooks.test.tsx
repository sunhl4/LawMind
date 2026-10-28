/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsPlaybooks } from "./LawmindSettingsPlaybooks";
import { settleConfirmDialog } from "./lawmind-confirm-dialog";

const BOOK = {
  id: "prc.contract.general",
  name: "中国法合同审查（通用）",
  jurisdiction: "PRC" as const,
  version: "1.0.0",
  stance: "偏委托方",
  acceptableRange: "责任上限不低于合同金额。",
  escalationTriggers: ["行政处罚"],
  deliverableTypes: ["contract.review"],
  criteria: [
    {
      id: "dispute_clause",
      kind: "green" as const,
      title: "有争议解决条款",
      check: { kind: "clause_present" as const },
      clauseTypes: ["dispute" as const],
    },
  ],
};

describe("LawmindSettingsPlaybooks", () => {
  let host: HTMLDivElement;
  let root: Root;
  let posts: Array<Record<string, unknown>>;
  let deletes: string[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    posts = [];
    deletes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        if (method === "POST" && url.endsWith("/api/playbooks")) {
          const rawBody = typeof init?.body === "string" ? init.body : "{}";
          posts.push(JSON.parse(rawBody) as Record<string, unknown>);
          return new Response(JSON.stringify({ ok: true, playbook: BOOK }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "DELETE" && url.includes("/api/playbooks/")) {
          deletes.push(url);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/playbooks")) {
          return new Response(
            JSON.stringify({
              ok: true,
              playbooks: [
                {
                  id: BOOK.id,
                  name: BOOK.name,
                  version: BOOK.version,
                  criteriaCount: BOOK.criteria.length,
                  deliverableTypes: BOOK.deliverableTypes,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes(`/api/playbooks/${BOOK.id}`)) {
          return new Response(JSON.stringify({ ok: true, playbook: BOOK }), {
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
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    settleConfirmDialog(false);
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("lists, edits and saves a playbook", async () => {
    await act(async () => {
      root.render(<LawmindSettingsPlaybooks apiBase="http://127.0.0.1:8765" />);
    });
    await flush();
    expect(host.textContent).toContain("中国法合同审查（通用）");
    expect(host.textContent).toContain("适用 contract.review");

    await act(async () => {
      (
        host.querySelector(
          '[data-testid="lm-playbook-edit-prc.contract.general"]',
        ) as HTMLButtonElement
      ).click();
    });
    await flush();

    const idInput = host.querySelector('[data-testid="lm-playbook-id"]') as HTMLInputElement;
    expect(idInput.value).toBe(BOOK.id);
    expect(idInput.disabled).toBe(true);

    const nameInput = host.querySelector('[data-testid="lm-playbook-name"]') as HTMLInputElement;
    // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(nameInput, "改过的剧本名称");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      (host.querySelector('[data-testid="lm-playbook-save"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      id: BOOK.id,
      name: "改过的剧本名称",
      deliverableTypes: ["contract.review"],
      criteria: [
        {
          id: "dispute_clause",
          kind: "green",
          title: "有争议解决条款",
          check: { kind: "clause_present" },
          clauseTypes: ["dispute"],
        },
      ],
    });
    expect(host.querySelector('[data-testid="lm-playbook-hint"]')?.textContent).toContain("已保存");
  });

  it("saves a text-level check through the editor", async () => {
    await act(async () => {
      root.render(<LawmindSettingsPlaybooks apiBase="http://127.0.0.1:8765" />);
    });
    await flush();

    await act(async () => {
      (
        host.querySelector(
          '[data-testid="lm-playbook-edit-prc.contract.general"]',
        ) as HTMLButtonElement
      ).click();
    });
    await flush();

    const select = host.querySelector(
      '[data-testid="lm-playbook-check-kind-0"]',
    ) as HTMLSelectElement;
    // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
    const selectSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      selectSetter?.call(select, "phrase_absent");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    const phrases = host.querySelector(
      '[data-testid="lm-playbook-phrases-0"]',
    ) as HTMLTextAreaElement;
    expect(phrases).toBeTruthy();
    // oxlint-disable-next-line typescript/unbound-method -- React 受控输入要走原型 setter。
    const textSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      textSetter?.call(phrases, "保证胜诉");
      phrases.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      (host.querySelector('[data-testid="lm-playbook-save"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      criteria: [
        {
          id: "dispute_clause",
          check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
        },
      ],
    });
  });

  it("deletes after the confirm dialog", async () => {
    await act(async () => {
      root.render(<LawmindSettingsPlaybooks apiBase="http://127.0.0.1:8765" />);
    });
    await flush();

    await act(async () => {
      (
        host.querySelector(
          '[data-testid="lm-playbook-delete-prc.contract.general"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      settleConfirmDialog(true);
      await Promise.resolve();
    });
    await flush();

    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("prc.contract.general");
  });

  it("blocks saving an invalid draft before calling the API", async () => {
    await act(async () => {
      root.render(<LawmindSettingsPlaybooks apiBase="http://127.0.0.1:8765" />);
    });
    await flush();

    await act(async () => {
      (host.querySelector('[data-testid="lm-playbook-new"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (host.querySelector('[data-testid="lm-playbook-save"]') as HTMLButtonElement).click();
    });
    await flush();

    expect(posts).toHaveLength(0);
    expect(host.querySelector('[data-testid="lm-playbook-hint"]')?.textContent).toContain("剧本编号");
  });
});
