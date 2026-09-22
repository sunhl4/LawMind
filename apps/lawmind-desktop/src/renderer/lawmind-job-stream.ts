import { fetchApi } from "./api-client-proxy";

export type JobStreamPayload = {
  ok?: boolean;
  job?: Record<string, unknown>;
};

/**
 * 鉴权版 jobs SSE 订阅：EventSource 无法携带 Authorization，本地 API 又强制 Bearer，
 * 故统一用 fetch + reader 解析 `data:` 帧（忽略 `: ping` 心跳）。
 * 服务端在 job 终态后主动结束流；结束后回调 onError（调用方统一做清理/回退轮询）。
 * 返回关闭函数（abort）。
 */
export function openJobEventStream(args: {
  apiBase: string;
  jobId: string;
  onMessage: (data: JobStreamPayload) => void;
  onOpen?: () => void;
  onError?: () => void;
}): () => void {
  const controller = new AbortController();
  const base = args.apiBase.replace(/\/$/, "");
  const url = `${base}/api/jobs/${encodeURIComponent(args.jobId)}/stream`;
  void (async () => {
    let ended = false;
    try {
      const res = await fetchApi(
        url,
        {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        },
        { timeoutMs: 0, tag: "job-stream" },
      );
      if (!res.ok || !res.body) {
        ended = true;
        args.onError?.();
        return;
      }
      args.onOpen?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) {
            continue;
          }
          try {
            args.onMessage(JSON.parse(data) as JobStreamPayload);
          } catch {
            /* malformed SSE frame */
          }
        }
      }
      ended = true;
      args.onError?.();
    } catch {
      if (!ended && !controller.signal.aborted) {
        args.onError?.();
      }
    }
  })();
  return () => controller.abort();
}
