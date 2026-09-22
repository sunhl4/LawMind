/**
 * @vitest-environment jsdom
 *
 * 回归：打开一条旧对话时，compose 的案件芯片必须回到该对话绑的那一案。
 *
 * 背景（真实事故）：助手写入落点由「本回合带来的 matterId」决定。芯片若停在
 * 上一次选的另一个案子，打开旧对话再补材料就会把本对话改绑过去，材料落进
 * 不是这一件的案件里。所以要有一条测试钉住「打开对话 → 芯片跟着回到该案」。
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./lawmind-app-bootstrap";
import { useLawmindChatSessions, type UseLawmindChatSessionsInput } from "./useLawmindChatSessions";

describe("useLawmindChatSessions 打开对话时同步 compose 案件芯片", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // jsdom 在这个 vitest 环境里没有可用的 localStorage（持久化活动会话要用）。
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  function renderProbe(opts: {
    setContextMatterId: (id: string | null) => void;
    /** 模拟 /api/sessions/:id 回传的 matterId。 */
    sessionMatterId: string | null;
  }) {
    const probe: { select?: (sessionId: string) => Promise<void> } = {};
    function Probe() {
      const api = useLawmindChatSessions({
        config: { apiBase: "http://127.0.0.1:1", workspaceDir: "/tmp/ws" } as AppConfig,
        selectedAssistantId: "a1",
        sessionByAssistant: {},
        setSessionByAssistant: vi.fn(),
        setChatSessionList: vi.fn(),
        setChatSessionsLoading: vi.fn(),
        setError: vi.fn(),
        // 真实实现会拿 /api/sessions/:id 的 matterId 回调第五个参数。
        loadSessionMessagesIntoState: (async (
          _assistantId: string,
          _sessionId: string,
          _signal?: AbortSignal,
          _overlay?: unknown,
          onSessionMatter?: (matterId: string | null) => void,
        ) => {
          onSessionMatter?.(opts.sessionMatterId);
          return true;
        }) as UseLawmindChatSessionsInput["loadSessionMessagesIntoState"],
        refreshChatSessionListForAssistant: vi.fn(async () => null),
        watchBackgroundSessionFnRef: { current: async () => undefined },
        setMainView: vi.fn(),
        setSelectedAssistantId: vi.fn(),
        setContextMatterId: opts.setContextMatterId,
        assistants: [],
        modelCatalog: [],
        selectedModelId: "m1",
        flashComposeModelHint: vi.fn(),
      });
      probe.select = (sessionId: string) => api.selectChatSession(sessionId, "a1");
      return null;
    }
    act(() => {
      root.render(<Probe />);
    });
    return probe;
  }

  it("打开绑定案件的旧对话：芯片切回该案", async () => {
    const setContextMatterId = vi.fn();
    const probe = renderProbe({ setContextMatterId, sessionMatterId: "甲案" });
    await act(async () => {
      await probe.select?.("sess-jiayi");
    });
    expect(setContextMatterId).toHaveBeenCalledWith("甲案");
  });

  it("打开未绑案的对话：不动律师当前的芯片选择", async () => {
    const setContextMatterId = vi.fn();
    const probe = renderProbe({ setContextMatterId, sessionMatterId: null });
    await act(async () => {
      await probe.select?.("sess-unbound");
    });
    expect(setContextMatterId).not.toHaveBeenCalled();
  });
});
