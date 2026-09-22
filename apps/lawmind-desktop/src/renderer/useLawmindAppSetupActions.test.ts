/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_RUN_DEMO_MATTER_ID,
  FIRST_RUN_SEED_PROMPT,
  startWorkingConversation,
} from "./useLawmindAppSetupActions";
import { readComposePermissionMode } from "./lawmind-compose-prefs";

function mockStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

describe("startWorkingConversation (keys → working chat, zero choice)", () => {
  let seen: Array<{ pathname: string; body: unknown }>;
  let seeds: Array<{ matterId: string; seedPrompt: string }>;

  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    seen = [];
    seeds = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const pathname = new URL(url).pathname;
        seen.push({
          pathname,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the demo matter, records onboarding, sets executable defaults, and seeds the compose box", async () => {
    await startWorkingConversation("http://127.0.0.1:1", {
      onSeedReady: (p) => seeds.push(p),
    });
    expect(seen.map((s) => s.pathname)).toEqual([
      "/api/matters/create",
      "/api/onboarding/firstrun-wizard",
    ]);
    expect(seen[0]?.body).toEqual({ matterId: FIRST_RUN_DEMO_MATTER_ID });
    // 钥匙后直接可执行，不落只读/计划模式。
    expect(readComposePermissionMode()).toBe("standard");
    // 落点就在对话输入框，带种子提示。
    expect(seeds).toEqual([
      { matterId: FIRST_RUN_DEMO_MATTER_ID, seedPrompt: FIRST_RUN_SEED_PROMPT },
    ]);
    // 不再请求首跑弹窗。
    expect(window.sessionStorage.getItem("lm.firstRun.requestOpen")).toBeNull();
    expect(window.localStorage.getItem("lm.firstRun.dismissed")).toBe("1");
  });

  it("no-ops without an api base (nothing to create)", async () => {
    await startWorkingConversation(undefined, { onSeedReady: (p) => seeds.push(p) });
    expect(seen).toEqual([]);
    expect(seeds).toEqual([]);
  });

  it("surfaces a failed matter create instead of pretending it started", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "无法创建演示案件" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      startWorkingConversation("http://127.0.0.1:1", { onSeedReady: (p) => seeds.push(p) }),
    ).rejects.toThrow(/无法创建演示案件/);
    expect(seeds).toEqual([]);
  });
});
