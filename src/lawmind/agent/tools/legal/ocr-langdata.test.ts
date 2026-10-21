import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureOcrLangData,
  ocrLangFileName,
  OcrLangDataError,
  resolveBundledOcrLangDataDir,
  resolveOcrLangDataCacheDir,
  resolveOcrLangs,
} from "./ocr-langdata.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** 解压后 300KB 的合法 gzip，足以通过完整性校验。 */
function validLangData(): Buffer {
  return zlib.gzipSync(Buffer.alloc(300_000, 7));
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveOcrLangs", () => {
  it("splits on + and trims", () => {
    expect(resolveOcrLangs("chi_sim+eng")).toEqual(["chi_sim", "eng"]);
    expect(resolveOcrLangs(" chi_sim + ")).toEqual(["chi_sim"]);
  });

  it("falls back to Chinese + English when empty", () => {
    // 中文扫描件是主场景：默认只认英文会把正文读成空白。
    expect(resolveOcrLangs("")).toEqual(["chi_sim", "eng"]);
    expect(resolveOcrLangs(undefined)).toEqual(["chi_sim", "eng"]);
  });
});

describe("resolveOcrLangDataCacheDir", () => {
  it("honors LAWMIND_OCR_CACHE_DIR", () => {
    expect(
      resolveOcrLangDataCacheDir({ LAWMIND_OCR_CACHE_DIR: "/tmp/lm-ocr-cache" }, "darwin"),
    ).toBe(path.resolve("/tmp/lm-ocr-cache"));
  });

  it("keeps language data out of the workspaces on each platform", () => {
    const mac = resolveOcrLangDataCacheDir({}, "darwin");
    expect(mac).toContain(path.join("Library", "Caches", "LawMind", "ocr", "tessdata"));
    const linux = resolveOcrLangDataCacheDir({ XDG_CACHE_HOME: "/tmp/xdg" }, "linux");
    expect(linux).toBe(path.join("/tmp/xdg", "lawmind", "ocr", "tessdata"));
  });
});

describe("resolveBundledOcrLangDataDir", () => {
  it("returns null until every requested language is present", async () => {
    const dir = tmp("lm-ocr-bundle-");
    await fsp.writeFile(path.join(dir, ocrLangFileName("chi_sim")), validLangData());
    const env = { LAWMIND_OCR_DATA_DIR: dir };
    expect(
      resolveBundledOcrLangDataDir({ LAWMIND_RESOURCES_PATH: tmp("lm-res-") }, ["chi_sim"]),
    ).toBe(null);
    expect(resolveBundledOcrLangDataDir(env, ["chi_sim", "eng"])).toBe(null);
    await fsp.writeFile(path.join(dir, ocrLangFileName("eng")), validLangData());
    expect(resolveBundledOcrLangDataDir(env, ["chi_sim", "eng"])).toBe(dir);
  });
});

describe("ensureOcrLangData", () => {
  it("rejects an explicit data dir that is missing a language instead of silently downloading", async () => {
    const dir = tmp("lm-ocr-explicit-");
    await expect(
      ensureOcrLangData(["chi_sim"], { env: { LAWMIND_OCR_DATA_DIR: dir } }),
    ).rejects.toBeInstanceOf(OcrLangDataError);
    await expect(
      ensureOcrLangData(["chi_sim"], { env: { LAWMIND_OCR_DATA_DIR: dir } }),
    ).rejects.toThrow(/缺少或为空：chi_sim\.traineddata\.gz/);
  });

  it("uses the bundled dir without any network access", async () => {
    const dir = tmp("lm-ocr-bundle-");
    await fsp.writeFile(path.join(dir, ocrLangFileName("chi_sim")), validLangData());
    const fetcher = vi.fn();
    const data = await ensureOcrLangData(["chi_sim"], {
      env: { LAWMIND_OCR_DATA_DIR: dir },
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(data).toEqual({ dir, gzip: true, fromBundle: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads into the cache dir and replaces a truncated file", async () => {
    const cache = tmp("lm-ocr-cache-");
    const good = validLangData();
    const fetcher = vi.fn(async () => {
      // 第一次给截断的 gzip，第二次给完整文件：模拟网络中断后重试。
      const body = fetcher.mock.calls.length === 1 ? good.subarray(0, 64) : good;
      return new Response(body, { status: 200 });
    });
    const data = await ensureOcrLangData(["chi_sim"], {
      env: { LAWMIND_OCR_CACHE_DIR: cache },
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(data).toEqual({ dir: cache, gzip: true, fromBundle: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const written = await fsp.readFile(path.join(cache, ocrLangFileName("chi_sim")));
    expect(zlib.gunzipSync(written).length).toBe(300_000);
  });

  it("reports a readable failure when every source fails", async () => {
    const cache = tmp("lm-ocr-cache-");
    const fetcher = vi.fn(async () => new Response("upstream down", { status: 503 }));
    await expect(
      ensureOcrLangData(["chi_sim"], {
        env: { LAWMIND_OCR_CACHE_DIR: cache },
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/OCR 语言包（chi_sim）不可用：.*HTTP 503/);
  });

  it("stops before downloading once the budget is exhausted", async () => {
    const cache = tmp("lm-ocr-cache-");
    const fetcher = vi.fn();
    await expect(
      ensureOcrLangData(["chi_sim"], {
        env: { LAWMIND_OCR_CACHE_DIR: cache },
        deadline: Date.now() - 1,
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/超出本轮时间预算/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("downloads a language pack once when several OCR jobs start together", async () => {
    const cache = tmp("lm-ocr-cache-");
    const good = validLangData();
    const fetcher = vi.fn(async () => new Response(good, { status: 200 }));
    const opts = {
      env: { LAWMIND_OCR_CACHE_DIR: cache },
      fetcher: fetcher as unknown as typeof fetch,
    };
    const [a, b] = await Promise.all([
      ensureOcrLangData(["chi_sim"], opts),
      ensureOcrLangData(["chi_sim"], opts),
    ]);
    expect(a.dir).toBe(cache);
    expect(b.dir).toBe(cache);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
