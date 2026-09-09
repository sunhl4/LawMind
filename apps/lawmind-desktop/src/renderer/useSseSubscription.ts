import { useEffect, useRef, useState, useCallback } from "react";
import { subscribeToSseStream, type SseConnectionState, type SseMessage } from "./sse-client";

export type UseSseSubscriptionOptions = {
  enabled?: boolean;
  onOpen?: () => void;
  onError?: () => void;
  onClose?: () => void;
};

export type UseSseSubscriptionResult = {
  state: SseConnectionState;
  connected: boolean;
  error: boolean;
};

/**
 * 按事件类型命名空间订阅统一 SSE 流。
 * 组件卸载时自动取消订阅；多个组件订阅相同 (apiBase, types) 会共享同一连接。
 */
export function useSseSubscription(
  apiBase: string | null | undefined,
  types: string[],
  onMessage: (message: SseMessage) => void,
  options?: UseSseSubscriptionOptions,
): UseSseSubscriptionResult {
  const [state, setState] = useState<SseConnectionState>("connecting");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const memoizedTypes = types.toSorted().join(",");
  const stableTypes = useRef(types);
  stableTypes.current = types;

  const onOpenRef = useRef(options?.onOpen);
  const onErrorRef = useRef(options?.onError);
  const onCloseRef = useRef(options?.onClose);
  onOpenRef.current = options?.onOpen;
  onErrorRef.current = options?.onError;
  onCloseRef.current = options?.onClose;

  const handleOpen = useCallback(() => {
    setState("open");
    onOpenRef.current?.();
  }, []);

  const handleError = useCallback(() => {
    setState("error");
    onErrorRef.current?.();
  }, []);

  const handleClose = useCallback(() => {
    setState("closed");
    onCloseRef.current?.();
  }, []);

  useEffect(() => {
    if (!apiBase || options?.enabled === false) {
      setState(apiBase && options?.enabled === false ? "closed" : "connecting");
      return undefined;
    }
    setState("connecting");
    const unsubscribe = subscribeToSseStream(apiBase, stableTypes.current, {
      onMessage: (message) => onMessageRef.current(message),
      onOpen: handleOpen,
      onError: handleError,
      onClose: handleClose,
    });
    return () => {
      unsubscribe();
      setState("closed");
    };
  }, [apiBase, memoizedTypes, options?.enabled, handleOpen, handleError, handleClose]);

  return {
    state,
    connected: state === "open",
    error: state === "error",
  };
}
