import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withExclusiveFileLock } from "./io.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function freshLockPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-io-lock-"));
  dirs.push(dir);
  return path.join(dir, "queue.jsonl.lock");
}

/** 拿到一个确定已退出的 pid（spawnSync 同步等待子进程结束）。 */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  if (typeof child.pid !== "number") {
    throw new Error("failed to spawn throwaway child");
  }
  return child.pid;
}

describe("withExclusiveFileLock stale 自愈", () => {
  it("持锁进程已死（死 pid 锁文件）→ 新进程自愈接管", () => {
    const lockPath = freshLockPath();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), acquiredAt: Date.now() }), "utf8");
    const ran = withExclusiveFileLock(lockPath, () => "healed", { timeoutMs: 500, pollMs: 5 });
    expect(ran).toBe("healed");
    // 临界区结束后锁已释放。
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("锁龄超阈值但 pid 存活 → 判定 stale 并接管", () => {
    const lockPath = freshLockPath();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() - 120_000 }),
      "utf8",
    );
    const ran = withExclusiveFileLock(lockPath, () => "took-over", {
      timeoutMs: 500,
      pollMs: 5,
      staleMs: 1_000,
    });
    expect(ran).toBe("took-over");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("活 pid + 新锁不被误抢（照常 file_lock_timeout）", () => {
    const lockPath = freshLockPath();
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
      "utf8",
    );
    expect(() =>
      withExclusiveFileLock(lockPath, () => "nope", { timeoutMs: 60, pollMs: 5 }),
    ).toThrow(/file_lock_timeout/);
    // 未被接管：锁文件仍在（由「持锁方」清理）。
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("legacy 空锁：锁龄未超阈值不抢，超阈值可自愈", () => {
    const freshPath = freshLockPath();
    fs.writeFileSync(freshPath, "", "utf8");
    expect(() =>
      withExclusiveFileLock(freshPath, () => "nope", { timeoutMs: 60, pollMs: 5 }),
    ).toThrow(/file_lock_timeout/);

    const oldPath = freshLockPath();
    fs.writeFileSync(oldPath, "", "utf8");
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(oldPath, old, old);
    expect(
      withExclusiveFileLock(oldPath, () => "healed", { timeoutMs: 500, pollMs: 5, staleMs: 1_000 }),
    ).toBe("healed");
  });

  it("正常路径：写入 pid 元数据并在临界区后释放", () => {
    const lockPath = freshLockPath();
    let observed: string | undefined;
    const out = withExclusiveFileLock(
      lockPath,
      () => {
        observed = fs.readFileSync(lockPath, "utf8");
        return 42;
      },
      { timeoutMs: 200, pollMs: 5 },
    );
    expect(out).toBe(42);
    expect(JSON.parse(observed ?? "{}")).toMatchObject({ pid: process.pid });
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
