/**
 * OCR 语言包（tesseract traineddata）的定位、下载、校验与缓存。
 *
 * 为什么单独一层：
 * - tesseract.js 默认**首次识别时**才从 CDN 拉 `traineddata`，并缓存到进程 CWD；
 *   桌面版 CWD 往往不可写，网络慢时表现为一句 `fetch failed`，调用方只能猜「没有 OCR」。
 * - 默认实现没有超时、没有大小/完整性校验，断点续传失败会留下截断文件，之后每次
 *   OCR 都静默加载坏模型。
 * - 这里把「语言包放哪儿、怎么下、失败怎么报」收在一处，调用方只需要 `ensureOcrLangData`。
 *
 * 解析顺序：
 * 1. `LAWMIND_OCR_DATA_DIR`：显式指定（只读，缺文件直接报错，不偷偷联网）。
 * 2. 随安装包分发的 `tessdata`（`LAWMIND_RESOURCES_PATH/tessdata` 或开发态
 *    `apps/lawmind-desktop/resources/tessdata`）。
 * 3. 可写缓存目录（`LAWMIND_OCR_CACHE_DIR`，默认用户缓存目录），按需下载。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createOutboundProxy } from "../../../platform/outbound-proxy.js";

const LANGDATA_SUFFIX = ".traineddata.gz";
/** 解压后小于这个大小，基本可以判定是截断/错误页，而不是语言包。 */
const MIN_DECOMPRESSED_BYTES = 200_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const DOWNLOAD_ATTEMPTS = 2;
const MAX_LANGDATA_BYTES = 64 * 1024 * 1024;

const langDataProxy = createOutboundProxy({
  requestTag: "ocr-langdata",
  timeoutMs: DOWNLOAD_TIMEOUT_MS,
  maxResponseBytes: MAX_LANGDATA_BYTES,
});

export class OcrLangDataError extends Error {
  readonly name = "OcrLangDataError";
}

export type OcrLangData = {
  /** 传给 tesseract 的 `langPath`。 */
  dir: string;
  /** 是否为 `.traineddata.gz`；与缓存目录里落盘的形式一致。 */
  gzip: boolean;
  /** true 表示来自随包分发的只读目录，不应写缓存。 */
  fromBundle: boolean;
};

export type EnsureOcrLangDataOptions = {
  env?: NodeJS.ProcessEnv;
  /** 毫秒时间戳；超过后不再发起新请求。 */
  deadline?: number;
  /** 测试注入。 */
  fetcher?: typeof fetch;
};

/**
 * 默认语言包。中文合同/裁判文书是主场景，只识别英文会把中文扫描件读成空白，
 * 因此默认与文档（`docs/LAWMIND-DOCUMENT-INGEST.md`）保持 `chi_sim+eng`。
 */
export const DEFAULT_OCR_LANGS: readonly string[] = ["chi_sim", "eng"];

/** `LAWMIND_OCR_LANGS`（`chi_sim+eng`）解析；空值回退中文 + 英文。 */
export function resolveOcrLangs(raw = process.env.LAWMIND_OCR_LANGS): string[] {
  const parsed = (raw ?? "")
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_OCR_LANGS];
}

/** 语言数据文件名（tesseract 认这个后缀）。 */
export function ocrLangFileName(lang: string): string {
  return `${lang}${LANGDATA_SUFFIX}`;
}

/** 可写缓存目录。语言包与业务数据分开，不写进工作区。 */
export function resolveOcrLangDataCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.LAWMIND_OCR_CACHE_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const home = os.homedir();
  if (platform === "darwin") {
    return path.join(home, "Library", "Caches", "LawMind", "ocr", "tessdata");
  }
  if (platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    return path.join(base, "LawMind", "ocr", "tessdata");
  }
  const base = env.XDG_CACHE_HOME?.trim() || path.join(home, ".cache");
  return path.join(base, "lawmind", "ocr", "tessdata");
}

function hasEveryLang(dir: string, langs: readonly string[]): boolean {
  return langs.every((lang) => {
    try {
      const st = fs.statSync(path.join(dir, ocrLangFileName(lang)));
      // 0 字节文件是坏缓存，和缺文件一样不能用。
      return st.isFile() && st.size > 0;
    } catch {
      return false;
    }
  });
}

/** 随包分发的只读语言包目录；没有完整语言包时返回 null。 */
export function resolveBundledOcrLangDataDir(
  env: NodeJS.ProcessEnv = process.env,
  langs: readonly string[],
): string | null {
  const candidates: string[] = [];
  const explicit = env.LAWMIND_OCR_DATA_DIR?.trim();
  if (explicit) {
    candidates.push(path.resolve(explicit));
  }
  const resources = env.LAWMIND_RESOURCES_PATH?.trim();
  if (resources) {
    candidates.push(path.join(resources, "tessdata"));
  }
  const repoRoot = env.LAWMIND_REPO_ROOT?.trim();
  if (repoRoot) {
    candidates.push(path.join(repoRoot, "apps", "lawmind-desktop", "resources", "tessdata"));
  }
  for (const dir of candidates) {
    if (hasEveryLang(dir, langs)) {
      return dir;
    }
  }
  return null;
}

function validateLangData(buf: Buffer): { ok: true } | { ok: false; reason: string } {
  try {
    const raw = zlib.gunzipSync(buf);
    if (raw.length < MIN_DECOMPRESSED_BYTES) {
      return { ok: false, reason: `解压后仅 ${raw.length} 字节，疑似下载不完整` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `不是完整的 gzip 数据（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
}

function langDataUrls(lang: string): string[] {
  // 两条来源：tesseract.js 自己用的 jsdelivr 镜像 + 上游 tessdata。
  return [
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${ocrLangFileName(lang)}`,
    `https://tessdata.projectnaptha.com/4.0.0/${ocrLangFileName(lang)}`,
  ];
}

async function fetchLangData(
  url: string,
  opts: EnsureOcrLangDataOptions,
  errors: string[],
): Promise<Buffer | null> {
  const remaining = opts.deadline !== undefined ? opts.deadline - Date.now() : DOWNLOAD_TIMEOUT_MS;
  if (remaining <= 0) {
    errors.push("超出本轮时间预算");
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("下载超时", "AbortError")),
    Math.min(DOWNLOAD_TIMEOUT_MS, remaining),
  );
  try {
    const impl: typeof fetch = opts.fetcher ?? ((input, init) => langDataProxy.fetch(input, init));
    const res = await impl(url, { signal: controller.signal });
    if (!res.ok) {
      errors.push(`${url}: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      errors.push(`${url}: 空响应`);
      return null;
    }
    if (buf.length > MAX_LANGDATA_BYTES) {
      // 注入的 fetcher 不经过代理的大小上限，这里再兜一次，避免坏镜像打满内存。
      errors.push(`${url}: 响应过大（${buf.length} bytes）`);
      return null;
    }
    return buf;
  } catch (err) {
    errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 同一语言包的并发下载合并：批量读扫描件时多个文件会同时触发 OCR，
 * 没有这层每个文件都会各自下一遍 traineddata。
 */
const inFlightLangDownloads = new Map<string, Promise<void>>();

async function downloadLangFile(
  lang: string,
  target: string,
  opts: EnsureOcrLangDataOptions,
): Promise<void> {
  const errors: string[] = [];
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      errors.push("超出本轮时间预算");
      break;
    }
    for (const url of langDataUrls(lang)) {
      const buf = await fetchLangData(url, opts, errors);
      if (!buf) {
        continue;
      }
      const checked = validateLangData(buf);
      if (!checked.ok) {
        errors.push(`${url}: ${checked.reason}`);
        continue;
      }
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, target);
      return;
    }
  }
  throw new OcrLangDataError(
    `OCR 语言包（${lang}）不可用：${errors.slice(-3).join("；") || "下载失败"}`,
  );
}

async function ensureOneLangFile(
  lang: string,
  dir: string,
  opts: EnsureOcrLangDataOptions,
): Promise<void> {
  const target = path.join(dir, ocrLangFileName(lang));
  try {
    const existing = await fsp.readFile(target);
    if (validateLangData(existing).ok) {
      return;
    }
  } catch {
    /* 不存在或读不了：按缺失处理 */
  }
  await fsp.rm(target, { force: true }).catch(() => undefined);

  const running = inFlightLangDownloads.get(target);
  if (running) {
    await running;
    return;
  }
  const task = downloadLangFile(lang, target, opts);
  const tracked = task.finally(() => {
    inFlightLangDownloads.delete(target);
  });
  // 并发方的拒绝由各自的 await 处理；先挂一个处理器，避免未等待时出现
  // unhandledRejection（真正的错误仍会抛给调用方）。
  tracked.catch(() => undefined);
  inFlightLangDownloads.set(target, tracked);
  await task;
}

/**
 * 确保 `langs` 的语言包在本地可选。失败抛 {@link OcrLangDataError}（消息可直接给律师看）。
 */
export async function ensureOcrLangData(
  langs: readonly string[],
  opts: EnsureOcrLangDataOptions = {},
): Promise<OcrLangData> {
  const env = opts.env ?? process.env;
  const wanted = langs.length > 0 ? [...langs] : [...DEFAULT_OCR_LANGS];

  const explicit = env.LAWMIND_OCR_DATA_DIR?.trim();
  if (explicit) {
    const dir = path.resolve(explicit);
    const missing = wanted.filter((lang) => {
      const st = fs.existsSync(path.join(dir, ocrLangFileName(lang)))
        ? fs.statSync(path.join(dir, ocrLangFileName(lang)))
        : null;
      return !st?.isFile() || st.size === 0;
    });
    if (missing.length > 0) {
      throw new OcrLangDataError(
        `OCR 语言包目录 ${dir} 缺少或为空：${missing.map(ocrLangFileName).join("、")}`,
      );
    }
    return { dir, gzip: true, fromBundle: true };
  }

  const bundled = resolveBundledOcrLangDataDir(env, wanted);
  if (bundled) {
    return { dir: bundled, gzip: true, fromBundle: true };
  }

  const dir = resolveOcrLangDataCacheDir(env);
  await fsp.mkdir(dir, { recursive: true });
  for (const lang of wanted) {
    await ensureOneLangFile(lang, dir, opts);
  }
  return { dir, gzip: true, fromBundle: false };
}
