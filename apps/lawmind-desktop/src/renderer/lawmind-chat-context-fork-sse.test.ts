/**
 * @vitest-environment jsdom
 *
 * 渲染端 SSE 接线的定向测试。
 *
 * 为什么单独建这个 harness：`sendChatTurnStream` 此前**没有任何测试**——SSE 事件名
 * 与回调名之间的那根线（`case "xxx": callbacks.onXxx?.(...)`）完全是靠人眼看。
 * 这条线上出错的表现恰好是**静默**的：事件到了、界面没反应，日志里什么都没有。
 * 本次要断言的正是其中一条新线——`context_deferral_bounce`：
 * 它必须真的把「退让被反弹」告诉渲染端，界面才有机会清掉已经流出去的那句推诿。
 */

import { describe, expect, it, vi } from "vitest";
import { sendChatTurnStream } from "./lawmind-chat";

/** 把若干 SSE 块拼成一个 `text/event-stream` 响应（分块喂入，模拟真实网络切片）。 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

const BASE_ARGS = {
  apiBase: "http://127.0.0.1:1",
  message: "起草竞业限制解除条款",
  assistantId: "default",
  allowWebSearch: false,
};

describe("sendChatTurnStream · 退让反弹的渲染端接线", () => {
  it("delta 里的推诿原文先流出去，随后 bounce 事件到达（界面据此清空）", async () => {
    const PUNT = "本轮上下文预算已接近上限，请另开一轮。";
    const deltas: string[] = [];
    const bounces: Array<{ roundIndex: number; bounceCount: number }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          // 真实顺序：先流式吐字，再在回合边界判定退让并发 bounce。
          sse("delta", { roundIndex: 1, text: PUNT }),
          sse("compact_boundary", { midTurn: true, roundIndex: 2, droppedMessageCount: 18 }),
          sse("context_deferral_bounce", { roundIndex: 2, bounceCount: 1 }),
          sse("delta", { roundIndex: 2, text: "已按检索结果继续写完交付。" }),
          sse("payload", { ok: true, reply: "已按检索结果继续写完交付。", sessionId: "s1", status: "completed" }),
          sse("done", {}),
        ]),
      ),
    );

    const result = await sendChatTurnStream(BASE_ARGS, {
      onDelta: (text) => deltas.push(text),
      onContextDeferralBounce: (info) => bounces.push(info),
      onCompactBoundary: () => undefined,
    });

    // 推诿原文确实先到了渲染端（这就是「流式闪现」的成因——必须有后续动作清掉它）。
    expect(deltas[0]).toBe(PUNT);
    // 关键断言：bounce 事件必须真的抵达渲染端，否则清空逻辑永远不会触发。
    expect(bounces).toEqual([{ roundIndex: 2, bounceCount: 1 }]);
    // 反弹后的真实答复继续流。
    expect(deltas[deltas.length - 1]).toBe("已按检索结果继续写完交付。");
    expect(result.assistantMessage.text).toContain("已按检索结果继续写完交付");
    vi.unstubAllGlobals();
  });

  it("bounce 事件缺 roundIndex 时不回调（不让半截事件触发界面动作）", async () => {
    const bounces: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sse("context_deferral_bounce", { bounceCount: 1 }),
          sse("payload", { ok: true, reply: "x", sessionId: "s1" }),
          sse("done", {}),
        ]),
      ),
    );

    await sendChatTurnStream(BASE_ARGS, {
      onContextDeferralBounce: (info) => bounces.push(info),
    });
    expect(bounces).toEqual([]);
    vi.unstubAllGlobals();
  });
});
