import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileChatTurn } from "./lawmind-chat-reconcile";
import { fetchChatSessionSnapshot } from "./lawmind-chat-message-mutate";
vi.mock("./lawmind-chat-message-mutate", () => ({ fetchChatSessionSnapshot: vi.fn() }));
const args = () => ({ apiBase: "http://127.0.0.1:1", sessionId: "s", turnId: "new", assistantId: "a",
  signal: new AbortController().signal, intervalMs: 0, maxPolls: 2, onMessages: vi.fn() });
const turn = (turnId: string, status: string) => ({ turnId, status, startedAt: "2026-10-21T00:00:00Z",
  ...(status === "completed" ? { completedAt: "2026-10-21T00:01:00Z" } : {}) });
beforeEach(() => vi.clearAllMocks());

describe("stream reconciliation", () => {
  it("waits for this turn to persist instead of accepting an old assistant or idle process", async () => {
    vi.mocked(fetchChatSessionSnapshot)
      .mockResolvedValueOnce({ messages: [{ role: "assistant", text: "旧答复" }], latestTurn: turn("old", "completed") })
      .mockResolvedValueOnce({ messages: [{ role: "assistant", text: "本轮已写入" }], latestTurn: turn("new", "completed") });
    const opts = args();
    expect(await reconcileChatTurn(opts)).toBe("settled");
    expect(opts.onMessages).toHaveBeenCalledTimes(1);
    expect(opts.onMessages).toHaveBeenCalledWith([{ role: "assistant", text: "本轮已写入" }]);
  });
  it("does not replace the active placeholder with a partial transcript", async () => {
    vi.mocked(fetchChatSessionSnapshot).mockResolvedValue({ messages: [{ role: "user", text: "改稿" }], latestTurn: turn("new", "running") });
    const opts = args();
    expect(await reconcileChatTurn(opts)).toBe("unknown");
    expect(opts.onMessages).not.toHaveBeenCalled();
  });
  it.each(["awaiting_approval", "awaiting_clarification", "paused"])("returns paused for %s so queued writes remain held", async (status) => {
    vi.mocked(fetchChatSessionSnapshot).mockResolvedValue({ messages: [], latestTurn: turn("new", status) });
    expect(await reconcileChatTurn(args())).toBe("paused");
  });
  it("distinguishes an interrupted persisted turn after restart from success", async () => {
    vi.mocked(fetchChatSessionSnapshot).mockResolvedValue({ messages: [], latestTurn: { ...turn("new", "running"), interrupted: true } });
    expect(await reconcileChatTurn(args())).toBe("interrupted");
  });
  it("keeps missing turn identity unknown without reading a previous result", async () => {
    expect(await reconcileChatTurn({ ...args(), turnId: undefined })).toBe("unknown");
    expect(fetchChatSessionSnapshot).not.toHaveBeenCalled();
  });
  it("propagates cancellation to the snapshot request", async () => {
    const controller = new AbortController();
    vi.mocked(fetchChatSessionSnapshot).mockImplementation(async (_base, _session, _assistant, signal) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        controller.abort(new DOMException("Stopped", "AbortError"));
      }));
    await expect(reconcileChatTurn({ ...args(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("keeps unreachable outcomes unknown and bounded", async () => {
    vi.mocked(fetchChatSessionSnapshot).mockRejectedValue(new Error("offline"));
    expect(await reconcileChatTurn(args())).toBe("unknown");
    expect(fetchChatSessionSnapshot).toHaveBeenCalledTimes(2);
  });
});
