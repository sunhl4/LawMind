/**
 * 文件版本指纹：引用核对、回合内覆盖保护、外发审批绑定共用同一串。
 *
 * 口径是「**全字节** sha256 + stat 前后校验」，不是 mtime/size 摘要：
 *   - 引用与审批绑定要能发现「保留时间戳的中段改写」——`touch -r` 之后
 *     mtime 完全一致，只有内容哈希还认得出来；
 *   - 读写期间文件被替换 / 追加时，前后 `fstat` 不一致，直接返回 undefined，
 *     调用方按「无法核对」处理，不拿半个文件的哈希当结论。
 *
 * 因此这里不做采样哈希、也不做「按 mtime 缓存」：那两种省法都会把上面两条
 * 保证降级。能省的是系统调用次数与重复调用，见 `readChunk` 与调用方。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";

/**
 * 同步哈希期间可复用的读缓冲：`fileVersionOf` 无 await/callback，不会重入，
 * 每次开一份新 Buffer 只会给引用密集的回合添垃圾。
 */
let readChunk: Buffer | undefined;

function chunkBuffer(): Buffer {
  readChunk ??= Buffer.alloc(1024 * 1024);
  return readChunk;
}

/** Hash every byte: a middle-only edit with preserved timestamps must still be detected. */
export function fileVersionOf(absPath: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      absPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    const before = fs.fstatSync(fd);
    if (!before.isFile()) {
      return undefined;
    }
    const hash = createHash("sha256");
    // 1 MiB：一份 20 MB 的 docx 从 320 次 read(2) 降到 20 次。引用核对会对同一批
    // 材料反复取版本，分块太碎时系统调用本身就是主要开销。
    const chunk = chunkBuffer();
    let offset = 0;
    while (offset < before.size) {
      const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (!count) {
        return undefined;
      }
      hash.update(chunk.subarray(0, count));
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      return undefined;
    }
    return `${after.size}:${after.mtimeMs}:${hash.digest("hex")}`;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}
