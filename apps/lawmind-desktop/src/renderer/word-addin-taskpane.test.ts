/**
 * @vitest-environment jsdom
 *
 * Word 任务窗格的**假 Word** 驱动测试。
 *
 * 真机踩过一次：`doc.changeTrackingMode` 是队列属性，不 `load` + `sync` 就读会被 Word 拒
 * （「属性…不可用…请先调用 load 方法」）。那次只能靠律师点一下才发现，所以这里做一个
 * 会说同样话的假 Word：读未 load 的属性就抛同样的错，让这类错法在 CI 里必挂。
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

// vitest 以仓库根为 cwd；这个文件被转译后 import.meta.url 不是 file URL，故用 cwd 定位。
const TASKPANE_JS = path.join(
  process.cwd(),
  "apps/lawmind-desktop/resources/word-addin/taskpane.js",
);

type Internals = {
  applyHunksInWord: (hunks: Array<{ find: string; replace: string; comment?: string }>) => Promise<{
    applied: number;
    missed: string[];
  }>;
  stateLabel: (s: string) => string;
  api: (path: string, init?: Record<string, unknown>) => Promise<unknown>;
  isLoopbackAuthError: (err: unknown) => boolean;
  humanApiError: (err: unknown) => string;
  configNow: () => { token?: string };
};

/** Word 读未 load 属性时的原话（真机报错逐字照抄）。 */
function unloadedError(name: string): Error {
  return new Error(
    `属性“${name}”不可用。读取属性的值之前，请先对包含对象调用 load 方法，再对关联的请求上下文调用 "context.sync()"。`,
  );
}

function makeFakeWord(initialText: string, opts?: { trackAll?: boolean }) {
  const log: string[] = [];
  let text = initialText;
  let mode = "off";
  let modeLoaded = false;
  const pendingSearches: Array<{
    find: string;
    items?: Array<{ insertText: unknown }>;
    wantItems?: boolean;
  }> = [];

  const document = {
    load(field: string) {
      if (field === "changeTrackingMode") {
        modeLoaded = true;
      }
      return document;
    },
    get changeTrackingMode() {
      if (!modeLoaded) {
        throw unloadedError("changeTrackingMode");
      }
      return mode;
    },
    set changeTrackingMode(next: string) {
      log.push(`setMode:${next}`);
      mode = next;
    },
    body: {
      search(find: string) {
        // 与 Word.js 同形：search 返回一个**代理对象**，load("items") 后 sync 才填 items。
        const proxy: {
          find: string;
          items?: Array<{ insertText: unknown }>;
          wantItems?: boolean;
        } = { find };
        pendingSearches.push(proxy);
        return {
          load(field: string) {
            if (field !== "items") {
              throw new Error(`unexpected load(${field})`);
            }
            proxy.wantItems = true;
            return proxy;
          },
          get items() {
            return proxy.items;
          },
        };
      },
    },
  };

  const context = {
    document,
    sync() {
      while (pendingSearches.length > 0) {
        const search = pendingSearches.shift();
        if (!search || search.wantItems !== true) {
          // 没 load 就没人读 items：Word 也不会填。
          continue;
        }
        const hits: Array<{ insertText: unknown }> = [];
        let from = 0;
        for (;;) {
          const at = text.indexOf(search.find, from);
          if (at < 0) {
            break;
          }
          // 注意：命中位置在后续替换后会变；假 Word 只保证「当时」的命中集合，
          // 足够验证「多处命中不落改」的判定。
          const hitText = search.find;
          const atNow = at;
          hits.push({
            insertText(replaceWith: string) {
              log.push(`replace:${hitText}->${replaceWith}`);
              text = text.slice(0, atNow) + replaceWith + text.slice(atNow + hitText.length);
              return {
                insertComment(comment: string) {
                  log.push(`comment:${comment}`);
                },
              };
            },
          });
          from = at + hitText.length;
        }
        search.items = hits;
      }
      return Promise.resolve();
    },
  };

  const Word = {
    InsertLocation: { replace: "replace" },
    ChangeTrackingMode: opts?.trackAll === false ? undefined : { trackAll: "trackAll", off: "off" },
    run(fn: (ctx: unknown) => unknown) {
      return Promise.resolve(fn(context));
    },
  };

  return { Word, context, log, textNow: () => text };
}

function bootTaskpane(word: unknown, config?: Record<string, unknown>): Internals {
  const source = fs.readFileSync(TASKPANE_JS, "utf8");
  const sandbox: Record<string, unknown> = {
    window: {
      LAWMIND_ADDIN: { base: "http://localhost:52100", token: "t", testHook: true, ...config },
    },
    document: {
      getElementById: () => null,
      addEventListener: () => undefined,
      createElement: () => ({ classList: { add: () => undefined }, appendChild: () => undefined }),
    },
    fetch: () => Promise.reject(new Error("network not expected in this test")),
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    Promise,
    JSON,
    console,
    Word: word,
  };
  const windowStub = sandbox.window as Record<string, unknown>;
  windowStub.document = sandbox.document;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const internals = windowStub.LAWMIND_ADDIN_INTERNALS as Internals | undefined;
  if (!internals) {
    throw new Error("taskpane.js did not expose internals (testHook 失效)");
  }
  return internals;
}

describe("word taskpane · applyHunksInWord", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).Word;
  });

  it("loads changeTrackingMode before reading it, and opens track changes first", async () => {
    const word = makeFakeWord("第一条 付款期限为十日内。第二条 本条其余内容保持不变。");
    const internals = bootTaskpane(word.Word);

    const result = await internals.applyHunksInWord([
      { find: "十日内", replace: "五个工作日内" },
      { find: "本条其余内容保持不变", replace: "本条其余内容保持完全不变" },
    ]);

    expect(result).toEqual({ applied: 2, missed: [] });
    // 先开修订轨，再改字；顺序反了就会是无痕迹编辑。
    expect(word.log[0]).toBe("setMode:trackAll");
    expect(word.log.indexOf("setMode:trackAll")).toBeLessThan(
      word.log.findIndex((l) => l.startsWith("replace:")),
    );
    // 收工恢复律师原本的修订轨设置。
    expect(word.log.at(-1)).toBe("setMode:off");
    expect(word.textNow()).toContain("五个工作日内");
    expect(word.textNow()).toContain("本条其余内容保持完全不变");
  });

  it("reports anchors that cannot be placed instead of guessing", async () => {
    const word = makeFakeWord("甲方与甲方各自履行。");
    const internals = bootTaskpane(word.Word);

    const result = await internals.applyHunksInWord([
      { find: "甲方", replace: "委托人" },
      { find: "不存在的锚点", replace: "不该落改" },
      { find: "各自履行", replace: "分别履行" },
    ]);

    expect(result.applied).toBe(1);
    expect(result.missed).toEqual(["甲方（命中 2 处）", "不存在的锚点"]);
    // 多处命中的锚点一个字都不能动。
    expect(word.textNow()).toContain("甲方与甲方");
    expect(word.textNow()).toContain("分别履行");
  });

  it("writes a comment only when that suggestion asks for one", async () => {
    const word = makeFakeWord("十日内付款。");
    const internals = bootTaskpane(word.Word);
    await internals.applyHunksInWord([
      { find: "十日内", replace: "五个工作日内", comment: "付款期过短" },
    ]);
    expect(word.log).toContain("comment:付款期过短");
    expect(word.log.indexOf("setMode:trackAll")).toBeLessThan(word.log.indexOf("comment:付款期过短"));

    const plain = makeFakeWord("十日内付款。");
    const again = bootTaskpane(plain.Word);
    await again.applyHunksInWord([{ find: "十日内", replace: "五个工作日内" }]);
    expect(plain.log.some((line) => line.startsWith("comment:"))).toBe(false);
  });

  it("refuses to edit at all when the Word build has no tracked changes", async () => {
    const word = makeFakeWord("十日内付款。", { trackAll: false });
    const internals = bootTaskpane(word.Word);

    await expect(internals.applyHunksInWord([{ find: "十日内", replace: "五个工作日内" }])).rejects.toThrow(
      /不支持以修订轨方式落改/,
    );
    // 关键：什么都不改，绝不退化成无痕迹编辑。
    expect(word.log).toEqual([]);
    expect(word.textNow()).toBe("十日内付款。");
  });

  it("writes a unique WPS range as a tracked change and leaves repeated anchors untouched", async () => {
    const edits: string[] = [];
    let text = "十日内付款。甲方与甲方。";
    let tracking = false;
    const doc = {
      TrackRevisions: false,
      Content: {
        get Text() {
          return text;
        },
      },
      Range(start: number, end: number) {
        return {
          set Text(next: string) {
            edits.push(`${tracking ? "tracked" : "plain"}:${start}:${text.slice(start, end)}=>${next}`);
            text = text.slice(0, start) + next + text.slice(end);
          },
        };
      },
    };
    Object.defineProperty(doc, "TrackRevisions", {
      get() {
        return tracking;
      },
      set(next: boolean) {
        tracking = next;
      },
    });
    const internals = bootTaskpane(makeFakeWord("x").Word) as Internals & {
      applyHunksInWps: (
        hunks: Array<{ find: string; replace: string }>,
        document: unknown,
      ) => Promise<{ applied: number; missed: string[] }>;
    };
    const result = await internals.applyHunksInWps(
      [
        { find: "十日内", replace: "五个工作日内" },
        { find: "甲方", replace: "委托人" },
      ],
      doc,
    );
    expect(result.applied).toBe(1);
    expect(result.missed).toEqual(["甲方（命中 2 处）"]);
    expect(text).toContain("五个工作日内");
    expect(text).toContain("甲方与甲方");
    expect(edits).toEqual(["tracked:0:十日内=>五个工作日内"]);
    expect(tracking).toBe(false);
  });

  it("adds a WPS comment on the replaced span when the lawyer asks for one", async () => {
    const comments: string[] = [];
    let text = "十日内付款。";
    const doc = {
      TrackRevisions: true,
      Content: {
        get Text() {
          return text;
        },
      },
      Comments: {
        Add(_range: unknown, body: string) {
          comments.push(body);
        },
      },
      Range(start: number, end: number) {
        return {
          start,
          end,
          set Text(next: string) {
            text = text.slice(0, start) + next + text.slice(end);
          },
        };
      },
    };
    const internals = bootTaskpane(makeFakeWord("x").Word) as Internals & {
      applyHunksInWps: (
        hunks: Array<{ find: string; replace: string; comment?: string }>,
        document: unknown,
      ) => Promise<{ applied: number }>;
    };
    const result = await internals.applyHunksInWps(
      [{ find: "十日内", replace: "五个工作日内", comment: "付款期过短" }],
      doc,
    );
    expect(result.applied).toBe(1);
    expect(comments).toEqual(["付款期过短"]);
    expect(text).toContain("五个工作日内");
  });

  it("fails loudly if a future refactor reads the property before load again", async () => {
    // 这条是护栏本身：直接按「不 load 就读」的写法读假 Word，必须抛真机同款错误。
    const word = makeFakeWord("十日内付款。");
    const doc = (word.context as { document: Record<string, unknown> }).document;
    expect(() => doc.changeTrackingMode).toThrow(/请先对包含对象调用 load 方法/);
  });
});

describe("word taskpane · 状态文案说真话", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).Word;
  });

  it("says the desktop will auto-run when the switch is on", () => {
    const internals = bootTaskpane(makeFakeWord("x").Word, { autoRun: true });
    expect(internals.stateLabel("queued")).toContain("自动审查");
  });

  it("does not claim auto-run when this machine requires a desk-side confirm", () => {
    // 律所档位：自动取件关闭。这时说「正在自动审查」就是在说谎。
    const internals = bootTaskpane(makeFakeWord("x").Word, { autoRun: false });
    const label = internals.stateLabel("queued");
    expect(label).not.toContain("自动");
    expect(label).toContain("桌面端");
  });

  it("still labels every other state the same way in both modes", () => {
    const auto = bootTaskpane(makeFakeWord("x").Word, { autoRun: true });
    const manual = bootTaskpane(makeFakeWord("x").Word, { autoRun: false });
    for (const state of ["running", "ready", "failed", "needs_matter", "stale", "superseded"]) {
      expect(manual.stateLabel(state)).toBe(auto.stateLabel(state));
      expect(manual.stateLabel(state).length).toBeGreaterThan(0);
    }
  });
});

/**
 * 凭据自愈：401 → 重取同源 config.js → **重放一次**。
 *
 * 这条路径正是 2026-09-21 那个故障的修复面：桌面端重启后本地服务换了凭据，
 * 已打开的窗格原先只能人工重载（且只看到一句 `unauthorized`）。下面这些断言把
 * 「自动换上新凭据并重放」「只重放一次」「并发共享一次刷新」钉死。
 *
 * 用假 document + 假 fetch 驱动：脚本注入在 Node 里没有真实 loader，
 * 所以由 `head.appendChild` 模拟「加载完成 → window.LAWMIND_ADDIN 更新 → onload」。
 */
function bootTaskpaneForNetwork(opts: {
  /** 每次 fetch 的应答；用完后重复最后一条。 */
  responses: Array<{ status: number; body: unknown }>;
  /** 注入 config.js 后 window.LAWMIND_ADDIN 变成什么（不传 = 刷新拿不到新配置）。 */
  refreshed?: Record<string, unknown>;
  /** 脚本注入一律失败（模拟本机服务已不在这个端口）。 */
  scriptFails?: boolean;
}) {
  const source = fs.readFileSync(TASKPANE_JS, "utf8");
  const calls: Array<{ url: string; authorization: string }> = [];
  const injected: string[] = [];
  let index = 0;

  const windowStub: Record<string, unknown> = {
    LAWMIND_ADDIN: {
      base: "http://localhost:52100",
      token: "stale-token",
      clientId: "word-addin",
      epoch: 1,
      instanceId: "inst-1",
      testHook: true,
      autoRun: true,
    },
  };

  const documentStub = {
    getElementById: () => null,
    addEventListener: () => undefined,
    createElement: () => {
      // 假 script 元素：taskpane 用 addEventListener("load"/"error") 监听加载结果，
      // 所以这里把处理器收下来，由 appendChild 模拟「加载完成」再回调。
      const handlers: Record<string, Array<() => void>> = {};
      return {
        src: "",
        addEventListener(type: string, fn: () => void) {
          (handlers[type] ??= []).push(fn);
        },
        fire(type: string) {
          for (const fn of handlers[type] ?? []) {
            fn();
          }
        },
      };
    },
    head: {
      appendChild(el: { src?: string; fire?: (type: string) => void }) {
        injected.push(el.src ?? "");
        if (opts.scriptFails) {
          void Promise.resolve().then(() => el.fire?.("error"));
          return;
        }
        if (opts.refreshed) {
          windowStub.LAWMIND_ADDIN = opts.refreshed;
        }
        void Promise.resolve().then(() => el.fire?.("load"));
      },
    },
  };

  const fetchStub = (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({
      url,
      authorization: init?.headers?.authorization ?? "",
    });
    const response = opts.responses[Math.min(index, opts.responses.length - 1)];
    index += 1;
    const status = response?.status ?? 500;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response?.body ?? {}),
    });
  };

  const sandbox: Record<string, unknown> = {
    window: windowStub,
    document: documentStub,
    fetch: fetchStub,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    Promise,
    JSON,
    console,
  };
  windowStub.document = documentStub;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const internals = windowStub.LAWMIND_ADDIN_INTERNALS as Internals | undefined;
  if (!internals) {
    throw new Error("taskpane.js did not expose internals (testHook 失效)");
  }
  return { internals, calls, injected, windowStub };
}

describe("word taskpane · 凭据自愈（401 自动重连）", () => {
  it("401 后重取配置并重放一次，用上新凭据", async () => {
    const { internals, calls, injected } = bootTaskpaneForNetwork({
      responses: [
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 200, body: { ok: true, items: [] } },
      ],
      refreshed: { base: "http://localhost:52100", token: "fresh-token", clientId: "word-addin" },
    });

    const body = await internals.api("/api/word-addin/reviews");

    expect(body).toEqual({ ok: true, items: [] });
    // 请求发了两次：原请求（旧凭据）+ 重放（新凭据）。
    expect(calls).toHaveLength(2);
    expect(calls[0]?.authorization).toBe("Bearer stale-token");
    expect(calls[1]?.authorization).toBe("Bearer fresh-token");
    // 只注入了一次 config.js。
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain("/word-addin/config.js");
    expect(internals.configNow().token).toBe("fresh-token");
  });

  it("刷新拿到的配置里没有可用凭据时，不重放", async () => {
    const { internals, calls } = bootTaskpaneForNetwork({
      responses: [{ status: 401, body: { ok: false, error: "unauthorized" } }],
      // 脚本加载成功，但配置里没有 token（服务端异常 / 模板坏了）：不能拿旧凭据硬重放。
      refreshed: { base: "http://localhost:52100" },
    });

    await expect(internals.api("/api/word-addin/reviews")).rejects.toThrow(/unauthorized/);
    expect(calls).toHaveLength(1);
  });

  it("换上新凭据后仍是 401（凭据已被吊销）⇒ 恰好重放一次就放弃", async () => {
    const { internals, calls } = bootTaskpaneForNetwork({
      responses: [
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 401, body: { ok: false, error: "unauthorized" } },
      ],
      refreshed: { base: "http://localhost:52100", token: "fresh-token" },
    });

    // 关键：换完还是 401 就不再试了 —— 继续重试只会把真正的失败藏起来。
    await expect(internals.api("/api/word-addin/reviews")).rejects.toThrow(/unauthorized/);
    expect(calls).toHaveLength(2);
  });

  it("脚本注入失败（服务已换端口/已退出）时不重放", async () => {
    const { internals, calls } = bootTaskpaneForNetwork({
      responses: [{ status: 401, body: { ok: false, error: "unauthorized" } }],
      scriptFails: true,
    });

    await expect(internals.api("/api/word-addin/reviews")).rejects.toThrow(/unauthorized/);
    expect(calls).toHaveLength(1);
  });

  it("非 401 的错误不触发刷新（别把真失败当成过期）", async () => {
    const { internals, calls, injected } = bootTaskpaneForNetwork({
      responses: [{ status: 500, body: { ok: false, error: "internal_error" } }],
    });

    await expect(internals.api("/api/word-addin/reviews")).rejects.toThrow(/internal_error/);
    expect(calls).toHaveLength(1);
    expect(injected).toHaveLength(0);
  });

  it("并发 401 共享同一次刷新（轮询不会插出一堆 script 标签）", async () => {
    const { internals, calls, injected } = bootTaskpaneForNetwork({
      responses: [
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 401, body: { ok: false, error: "unauthorized" } },
        { status: 200, body: { ok: true } },
        { status: 200, body: { ok: true } },
        { status: 200, body: { ok: true } },
      ],
      refreshed: { base: "http://localhost:52100", token: "fresh-token" },
    });

    await Promise.all([
      internals.api("/api/word-addin/reviews"),
      internals.api("/api/word-addin/reviews"),
      internals.api("/api/word-addin/reviews"),
    ]);

    expect(calls).toHaveLength(6); // 3 原请求 + 3 重放
    expect(injected).toHaveLength(1); // 刷新只做了一次
  });

  it("只认 401：403（越权）不当作凭据问题", () => {
    const { internals } = bootTaskpaneForNetwork({
      responses: [{ status: 200, body: { ok: true } }],
    });
    expect(internals.isLoopbackAuthError({ status: 401 })).toBe(true);
    expect(internals.isLoopbackAuthError({ status: 403 })).toBe(false);
    expect(internals.isLoopbackAuthError(new Error("boom"))).toBe(false);
    expect(internals.isLoopbackAuthError(undefined)).toBe(false);
  });

  it("把 unauthorized 翻译成律师能照做的动作，而不是照搬服务端术语", () => {
    const { internals } = bootTaskpaneForNetwork({
      responses: [{ status: 200, body: { ok: true } }],
    });
    const text = internals.humanApiError({ status: 401, message: "unauthorized" });
    expect(text).not.toBe("unauthorized");
    expect(text).toContain("重新打开");
    // 非凭据错误照原样显示，不要吞掉真实原因。
    expect(internals.humanApiError(new Error("internal_error"))).toContain("internal_error");
  });
});
