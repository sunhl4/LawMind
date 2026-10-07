import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ignoreBrokenPipe, isBrokenPipeError, writeChildLog } from "./child-log-forward.mjs";

class FakeStream extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.writable = opts.writable ?? true;
    this.destroyed = opts.destroyed ?? false;
    this.writes = [];
    this.errorOnWrite = opts.errorOnWrite ?? null;
    this.throwOnWrite = opts.throwOnWrite ?? null;
  }

  write(chunk, cb) {
    this.writes.push(chunk);
    if (this.throwOnWrite) {
      throw this.throwOnWrite;
    }
    if (this.errorOnWrite) {
      queueMicrotask(() => {
        this.emit("error", this.errorOnWrite);
        cb?.(this.errorOnWrite);
      });
      return false;
    }
    queueMicrotask(() => cb?.());
    return true;
  }
}

describe("writeChildLog", () => {
  it("forwards a chunk when the parent stream is still open", () => {
    const stream = new FakeStream();
    expect(writeChildLog(stream, "hello")).toBe(true);
    expect(stream.writes).toEqual(["hello"]);
  });

  it("does not throw when write fails with EPIPE", async () => {
    const stream = new FakeStream({
      errorOnWrite: Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    });
    expect(() => writeChildLog(stream, "log")).not.toThrow();
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(stream.writes).toEqual(["log"]);
  });

  it("does not throw when write itself throws EPIPE", () => {
    const stream = new FakeStream({
      throwOnWrite: Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    });
    expect(writeChildLog(stream, "log")).toBe(false);
  });

  it("skips a destroyed stream", () => {
    const stream = new FakeStream({ destroyed: true });
    expect(writeChildLog(stream, "log")).toBe(false);
    expect(stream.writes).toEqual([]);
  });
});

describe("ignoreBrokenPipe", () => {
  it("swallows EPIPE on the stream error event", () => {
    const stream = new FakeStream();
    ignoreBrokenPipe(stream);
    expect(() =>
      stream.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
    ).not.toThrow();
  });

  it("recognizes Node's broken-pipe codes", () => {
    expect(isBrokenPipeError({ code: "EPIPE" })).toBe(true);
    expect(isBrokenPipeError({ code: "ERR_STREAM_DESTROYED" })).toBe(true);
    expect(isBrokenPipeError({ code: "ENOENT" })).toBe(false);
  });
});
