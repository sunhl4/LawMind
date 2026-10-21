/** Version fingerprint shared by evidence verification and optimistic writes. */
import { createHash } from "node:crypto";
import fs from "node:fs";

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
    const chunk = Buffer.alloc(64 * 1024);
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
