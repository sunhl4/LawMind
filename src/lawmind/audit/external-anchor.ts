/**
 * 审计外部锚定器（immutable uploader）。
 *
 * 将可验证审计摘要同步到用户指定的外部位置：
 *   - file:// 或本地文件路径：写到工作区外（如 U 盘、iCloud/OneDrive 本地同步目录）。
 *   - HTTPS 只写 URL：通过统一出口代理 HTTP PUT 上传；不发送历史，只写最新摘要。
 *
 * 同步失败仅告警，不阻断审计事件落盘；emit 侧以 fire-and-forget 方式调用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import type { OutboundProxy, OutboundProxyOptions } from "../platform/outbound-proxy.js";
import {
  buildSignedAuditExportSummary,
  resolveExternalAnchorUrl,
  type AuditExportSummary,
} from "./export-summary.js";

export type ExternalAnchorUploadResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

export interface ExternalAnchorUploader {
  readonly url: string;
  upload(
    summary: AuditExportSummary,
    signature: string | undefined,
    signal?: AbortSignal,
  ): Promise<ExternalAnchorUploadResult>;
  read(signal?: AbortSignal): Promise<{
    summary: AuditExportSummary;
    signature?: string;
    generatedAt?: string;
    schemaVersion?: number;
  } | null>;
}

function normalizeFileUrl(url: string): string {
  return url.replace(/^file:\/\/+/, "");
}

function packageBody(summary: AuditExportSummary, signature: string | undefined): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      summary,
      signature,
    },
    null,
    2,
  );
}

/** file:// 默认实现：原子写本地文件，读回 JSON。 */
export class FileExternalAnchorUploader implements ExternalAnchorUploader {
  readonly url: string;
  private readonly filePath: string;

  constructor(url: string) {
    this.url = url;
    this.filePath = path.resolve(normalizeFileUrl(url));
  }

  async upload(
    summary: AuditExportSummary,
    signature: string | undefined,
    _signal?: AbortSignal,
  ): Promise<ExternalAnchorUploadResult> {
    try {
      await writeFileAtomicAsync(this.filePath, packageBody(summary, signature));
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `file_write_failed:${msg}` };
    }
  }

  async read(_signal?: AbortSignal): Promise<{
    summary: AuditExportSummary;
    signature?: string;
    generatedAt?: string;
    schemaVersion?: number;
  } | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<{
        schemaVersion: number;
        generatedAt: string;
        summary: AuditExportSummary;
        signature: string;
      }>;
      if (!parsed.summary) {
        return null;
      }
      return {
        schemaVersion: parsed.schemaVersion,
        generatedAt: parsed.generatedAt,
        summary: parsed.summary,
        signature: parsed.signature,
      };
    } catch {
      return null;
    }
  }
}

/** HTTPS 只写上传；失败内部重试 3 次（含 5xx 与网络错误）。 */
export class HttpPutExternalAnchorUploader implements ExternalAnchorUploader {
  readonly url: string;
  private readonly proxyPromise: Promise<OutboundProxy>;
  private readonly maxRetries: number;

  constructor(url: string, opts?: { allowInsecure?: boolean; timeoutMs?: number }) {
    this.url = url;
    const parsed = new URL(url);
    const isHttp = parsed.protocol === "http:";
    const proxyOptions: OutboundProxyOptions = {
      allowInsecure: opts?.allowInsecure ?? isHttp,
      allowLocalNetwork: true,
      timeoutMs: opts?.timeoutMs ?? 30_000,
      maxRetries: 0,
    };
    this.maxRetries = 2;
    this.proxyPromise = (async () => {
      const { createOutboundProxy } = await import("../platform/outbound-proxy.js");
      return createOutboundProxy(proxyOptions);
    })();
  }

  async upload(
    summary: AuditExportSummary,
    signature: string | undefined,
    signal?: AbortSignal,
  ): Promise<ExternalAnchorUploadResult> {
    const proxy = await this.proxyPromise;
    const maxAttempts = 1 + this.maxRetries;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await proxy.fetch(this.url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: packageBody(summary, signature),
          signal,
        });
        if (res.ok) {
          return { ok: true };
        }
        if (attempt === maxAttempts - 1) {
          return { ok: false, error: `http_put_failed:${res.status}` };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === maxAttempts - 1) {
          return { ok: false, error: `http_put_error:${msg}` };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
    return { ok: false, error: "http_put_exhausted" };
  }

  async read(signal?: AbortSignal): Promise<{
    summary: AuditExportSummary;
    signature?: string;
    generatedAt?: string;
    schemaVersion?: number;
  } | null> {
    try {
      const proxy = await this.proxyPromise;
      const res = await proxy.fetch(this.url, { method: "GET", signal });
      if (!res.ok) {
        return null;
      }
      const parsed = (await res.json()) as Partial<{
        schemaVersion: number;
        generatedAt: string;
        summary: AuditExportSummary;
        signature: string;
      }>;
      if (!parsed.summary) {
        return null;
      }
      return {
        schemaVersion: parsed.schemaVersion,
        generatedAt: parsed.generatedAt,
        summary: parsed.summary,
        signature: parsed.signature,
      };
    } catch {
      return null;
    }
  }
}

export function createExternalAnchorUploader(url: string): ExternalAnchorUploader {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("external_anchor_url_empty");
  }
  if (/^file:\/\//i.test(trimmed) || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return new FileExternalAnchorUploader(trimmed);
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`unsupported_external_anchor_protocol:${parsed.protocol}`);
  }
  return new HttpPutExternalAnchorUploader(trimmed);
}

export type SyncExternalAnchorOptions = {
  key?: Buffer | null;
  signal?: AbortSignal;
};

/**
 * 同步审计摘要到外部锚。url 未配置时直接返回 skipped。
 * 失败仅返回错误对象并打印警告，不抛异常。
 */
export async function syncExternalAnchor(
  auditDir: string,
  url: string | undefined,
  opts?: SyncExternalAnchorOptions,
): Promise<ExternalAnchorUploadResult> {
  if (!url?.trim()) {
    return { ok: true, skipped: true };
  }
  let uploader: ExternalAnchorUploader;
  try {
    uploader = createExternalAnchorUploader(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LawMind audit] 外部锚 URL 无效: ${msg}`);
    return { ok: false, error: msg };
  }

  const { summary, signature } = buildSignedAuditExportSummary(auditDir, {
    key: opts?.key,
  });
  try {
    const result = await uploader.upload(summary, signature, opts?.signal);
    if (!result.ok) {
      console.warn(`[LawMind audit] 外部锚同步失败: ${result.error}`);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LawMind audit] 外部锚同步失败: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * 根据环境变量 LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL 同步。
 */
export async function syncExternalAnchorForAuditDir(
  auditDir: string,
  opts?: SyncExternalAnchorOptions,
): Promise<ExternalAnchorUploadResult> {
  return syncExternalAnchor(auditDir, resolveExternalAnchorUrl(), opts);
}

/**
 * 启动定期同步定时器（默认每 24 小时）。返回 stop 句柄。
 */
export function startAuditExternalAnchorSync(
  auditDir: string,
  url: string | undefined,
  opts?: SyncExternalAnchorOptions & { intervalMs?: number },
): { stop: () => void; syncNow: () => Promise<ExternalAnchorUploadResult> } {
  const intervalMs = opts?.intervalMs ?? 24 * 60 * 60 * 1000;
  let running = true;

  const syncNow = async () => {
    if (!running) {
      return { ok: false, error: "sync_stopped" };
    }
    return syncExternalAnchor(auditDir, url, opts);
  };

  const timer = setInterval(() => {
    void syncNow().catch(() => {
      /* 失败已内部告警 */
    });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      running = false;
      clearInterval(timer);
    },
    syncNow,
  };
}
