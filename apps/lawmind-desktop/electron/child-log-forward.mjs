/**
 * Forward a child process log chunk onto Electron's stdio.
 *
 * A packaged / detached Electron window often has a closed stdout pipe.
 * Node then throws uncaught `EPIPE` on `process.stdout.write`, which surfaces
 * as "A JavaScript error occurred in the main process".
 */

const BROKEN_PIPE = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

const guarded = new WeakSet();

export function isBrokenPipeError(err) {
  return Boolean(err && typeof err === "object" && BROKEN_PIPE.has(err.code));
}

export function ignoreBrokenPipe(stream) {
  if (!stream || guarded.has(stream)) {
    return;
  }
  guarded.add(stream);
  stream.on("error", (err) => {
    if (isBrokenPipeError(err)) {
      return;
    }
    console.error("[LawMind] stdio:", err);
  });
}

export function writeChildLog(stream, chunk) {
  ignoreBrokenPipe(stream);
  if (!stream || stream.destroyed || stream.writable === false) {
    return false;
  }
  try {
    return stream.write(chunk, (err) => {
      if (isBrokenPipeError(err)) {
        return;
      }
    });
  } catch (err) {
    if (isBrokenPipeError(err)) {
      return false;
    }
    throw err;
  }
}
