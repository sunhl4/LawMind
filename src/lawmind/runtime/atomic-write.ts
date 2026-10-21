/** Same-directory atomic replacement, with an optional optimistic version check. */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectFileVersion } from "./file-version-state.js";
import { fileVersionOf } from "./file-version.js";

export type AtomicWriteResult =
  | { ok: true; bytes: number; version: string }
  | {
      ok: false;
      code: "version_conflict" | "io_error" | "aborted";
      error: string;
      currentVersion?: string;
    };

export type AtomicWriteOpts = {
  /** undefined skips checking; empty string requires the destination to be absent. */
  expectedVersion?: string;
  encoding?: BufferEncoding;
  signal?: AbortSignal;
};

export async function atomicWriteFile(
  absPath: string,
  content: string | Buffer,
  opts: AtomicWriteOpts = {},
): Promise<AtomicWriteResult> {
  const encoding = opts.encoding ?? "utf8";
  const dir = path.dirname(absPath);
  const tmp = path.join(dir, `.${path.basename(absPath)}.${randomUUID()}.lawmind-tmp`);
  const check = (): AtomicWriteResult | undefined => {
    if (opts.signal?.aborted) {
      return { ok: false, code: "aborted", error: "已停止写入，原文件未改动。" };
    }
    const current = inspectFileVersion(absPath);
    if (current.state === "unverifiable") {
      return { ok: false, code: "io_error", error: "无法核对目标文件版本，本次没有覆盖。" };
    }
    const currentVersion = current.version;
    if (opts.expectedVersion !== undefined && currentVersion !== opts.expectedVersion) {
      return {
        ok: false,
        code: "version_conflict",
        currentVersion,
        error: "目标文件在读取后已被修改或删除。为避免覆盖，请改写副本或重新读取后再写。",
      };
    }
    return undefined;
  };
  try {
    const initial = check();
    if (initial) {
      return initial;
    }
    await fs.mkdir(dir, { recursive: true });
    const mode = await fs
      .stat(absPath)
      .then((stat) => stat.mode & 0o777)
      .catch(() => 0o600);
    const handle = await fs.open(tmp, "wx", mode);
    try {
      await handle.writeFile(content, { encoding });
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Recheck after the asynchronous write, immediately before the atomic replacement.
    // External writers cannot be locked by this process: a small check/rename window remains.
    // Capture the identity of our temp bytes before rename. A later external edit
    // must not become the baseline of the content we just wrote.
    const writtenVersion = fileVersionOf(tmp);
    if (!writtenVersion) {
      return { ok: false, code: "io_error", error: "临时文件版本无法核对，原件未改。" };
    }
    const conflict = check();
    if (conflict) {
      return conflict;
    }
    await fs.rename(tmp, absPath);
    return {
      ok: true,
      bytes: typeof content === "string" ? Buffer.byteLength(content, encoding) : content.length,
      version: writtenVersion,
    };
  } catch (err) {
    return {
      ok: false,
      code: "io_error",
      error: `写入失败：${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

export { fileVersionOf };
