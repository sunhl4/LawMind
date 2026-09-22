/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { subscribeToSseStream } from "./sse-client";
import { useSseSubscription } from "./useSseSubscription";

let capturedOnMessage: ((msg: { type: string; data: unknown }) => void) | null = null;
let _capturedOnOpen: (() => void) | null = null;
let _capturedOnError: (() => void) | null = null;
let _capturedOnClose: (() => void) | null = null;

vi.mock("./sse-client", () => ({
  subscribeToSseStream: vi.fn(
    (
      _apiBase: string,
      _types: string[],
      subscriber: {
        onMessage: (msg: { type: string; data: unknown }) => void;
        onOpen?: () => void;
        onError?: () => void;
        onClose?: () => void;
      },
    ) => {
      capturedOnMessage = subscriber.onMessage;
      _capturedOnOpen = subscriber.onOpen ?? null;
      _capturedOnError = subscriber.onError ?? null;
      _capturedOnClose = subscriber.onClose ?? null;
      return () => {
        capturedOnMessage = null;
        _capturedOnOpen = null;
        _capturedOnError = null;
        _capturedOnClose = null;
      };
    },
  ),
}));

function TestComponent(props: {
  apiBase: string;
  types: string[];
  onMessage: (msg: { type: string; data: unknown }) => void;
  enabled?: boolean;
  onOpen?: () => void;
}) {
  const { connected, error } = useSseSubscription(
    props.apiBase,
    props.types,
    props.onMessage,
    { enabled: props.enabled, onOpen: props.onOpen },
  );
  return (
    <div data-testid="state">
      {connected ? "connected" : error ? "error" : "connecting"}
    </div>
  );
}

describe("useSseSubscription", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it("subscribes and forwards messages", async () => {
    const messages: unknown[] = [];
    await act(async () => {
      root.render(
        <TestComponent
          apiBase="http://127.0.0.1:9999"
          types={["task:*"]}
          onMessage={(msg) => messages.push(msg)}
        />,
      );
    });
    await act(async () => {
      capturedOnMessage?.({ type: "task:abc:update", data: { status: "running" } });
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "task:abc:update", data: { status: "running" } });
  });

  it("does not subscribe when disabled", async () => {
    await act(async () => {
      root.render(
        <TestComponent
          apiBase="http://127.0.0.1:9999"
          types={["task:*"]}
          onMessage={() => {}}
          enabled={false}
        />,
      );
    });
    expect(capturedOnMessage).toBeNull();
  });

  it("does not resubscribe when inline onOpen callbacks change", async () => {
    await act(async () => {
      root.render(
        <TestComponent
          apiBase="http://127.0.0.1:9999"
          types={["task:*"]}
          onMessage={() => {}}
          onOpen={() => {}}
        />,
      );
    });
    const firstCalls = vi.mocked(subscribeToSseStream).mock.calls.length;
    await act(async () => {
      root.render(
        <TestComponent
          apiBase="http://127.0.0.1:9999"
          types={["task:*"]}
          onMessage={() => {}}
          onOpen={() => {}}
        />,
      );
    });
    expect(vi.mocked(subscribeToSseStream).mock.calls.length).toBe(firstCalls);
  });
});
