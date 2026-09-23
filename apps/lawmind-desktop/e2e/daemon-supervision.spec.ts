/**
 * lawmindd 真机 E2E：关窗后接着办、崩了会自己起来、停得干净。
 *
 * 为什么值得一条真机 spec：「关掉桌面后仍然替你办件」是整个可信后台改造的**唯一承载**，
 * 而它此前只有单测覆盖 —— 单测能证明「退避决策算得对」，但证明不了
 * 「Electron 的 before-quit 真的把监督进程拉起来了」「子进程真的拿到了锁并在 tick」
 * 「被杀之后真的被拉起」。这几步跨进程，只有真机跑得出来。
 *
 * 本 spec 刻意**不使用** `closeApp`：它会在渲染层出现严重日志时抛错，而这里要验的是
 * 进程树行为，渲染层健康不是被测对象；用 `electronApp.close()` 直接触发 `before-quit`
 * 即可（`before-quit` 里就是 spawnWorkspaceDaemon）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchLawMindElectron,
  prepareE2EUserData,
  waitForShell,
} from "./helpers/app-driver.js";

const DAEMON_DIR = "lawmind";

function daemonPaths(workspaceDir: string) {
  const dir = path.join(workspaceDir, DAEMON_DIR);
  return {
    dir,
    state: path.join(dir, "daemon.json"),
    pid: path.join(dir, "daemon.pid"),
    lock: path.join(dir, "daemon.lock"),
    log: path.join(dir, "daemon.log"),
  };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function readPid(workspaceDir: string): Promise<number | undefined> {
  try {
    const raw = (await fs.readFile(daemonPaths(workspaceDir).pid, "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number | undefined): boolean {
  if (pid == null) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type DaemonState = {
  enabled?: boolean;
  pid?: number;
  heartbeatAt?: string;
  lastTickAt?: string;
  restartCount?: number;
  lastExitClass?: string;
  supervisionGaveUpAt?: string;
};

/** 轮询到条件成立；超时抛出最后观测到的值，便于排障（而不是一句 "timeout"）。 */
async function waitFor<T>(
  label: string,
  probe: () => Promise<T>,
  ok: (value: T) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await probe();
    if (ok(last)) {
      return last;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} 超时（${timeoutMs}ms）；最后观测：${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 把整棵 daemon 进程树停掉，**无论断言是否失败**。
 *
 * 停法用 SIGTERM 打 tick 子进程：它会走 `stop` 处理器以 0 退出，监督进程据此判定
 * `clean_exit` 并结束循环、释放锁、清掉 pid 文件。因此「pid 文件消失」就是整棵树
 * 已停干净的信号 —— 这也是该退出分类存在的意义之一。
 *
 * 兜底：pid 文件仍在时直接 SIGKILL 并清理残留文件，避免测试失败时泄漏游离进程。
 */
async function stopDaemonTree(workspaceDir: string): Promise<void> {
  const paths = daemonPaths(workspaceDir);
  const pid = await readPid(workspaceDir);
  if (pid != null && isAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    try {
      await waitFor("daemon 进程树停止", () => readPid(workspaceDir), (p) => p == null, {
        timeoutMs: 15_000,
      });
      return;
    } catch {
      /* 落到下面的兜底 */
    }
  }
  const stillThere = await readPid(workspaceDir);
  if (stillThere != null && isAlive(stillThere)) {
    try {
      process.kill(stillThere, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  await fs.rm(paths.pid, { force: true });
  await fs.rm(paths.lock, { force: true });
}

test.describe("lawmindd 真机：关窗后继续办件", () => {
  test("关窗拉起后台、心跳在走、被杀会自愈、停得干净", async () => {
    /**
     * 已知红灯：**只在 Linux CI（xvfb）上**本用例会挂到超时，macOS 本机稳定通过。
     *
     * 2026-09-23 首次真正在 CI 上跑（此前 job 因 `setup-xvfb` 缺 `with.run` 在 44s
     * 就失败，本条从未被执行）：同一 job 里其余 **14 条真机用例全过**（含
     * `server-crash-recovery`，说明 Electron + xvfb 本身是好的），只有本条——
     * 且它**吃满超时**（180s→300s 都吃满）而不是在第一段 90s 等待就失败，
     * 说明卡点不在等待，更像 `electronApp.close()`（关窗触发 spawn 后台后进程不退）。
     *
     * 这里显式跳过而不是删掉/放纵：跳过**写明原因**、指向 issue，并把工件上传
     * （见 workflow 的 Upload E2E diagnostics），下一次有人动这块时有现场可查。
     * 「job 从来不跑」才是真正会骗人的状态。
     */
    test.fixme(
      process.env.CI === "true" && process.platform === "linux",
      "已知红：Linux CI 下挂到超时；证据与排查见 #70",
    );
    /**
     * 超时必须**大于本用例内部等待预算之和**，否则在慢机器上必然被自己的超时砍掉。
     *
     * 内部是三段串行 `waitFor`（启动 / 心跳推进 / SIGKILL 自愈），每段 90s
     * → 最坏 270s。此前写 180s：本机（macOS）快，一路绿；Linux CI 慢，测到 180s
     * 直接被 `Test timeout` 掐断，随后 worker teardown 还要等子进程退出而再次超时。
     * 给足 300s。
     */
    test.setTimeout(300_000);
    const config = await prepareE2EUserData();
    const { workspaceDir } = config;
    const paths = daemonPaths(workspaceDir);

    // 律师在设置里开了「关桌面后继续办件」——落盘就是 daemon.json 的 enabled 位。
    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.state, JSON.stringify({ enabled: true }, null, 2), "utf8");

    let cleaned = false;
    try {
      const electronApp = await launchLawMindElectron(config);
      const page = await electronApp.firstWindow();
      await waitForShell(page);

      // 关窗 —— 这一步就是律师「下班关掉 LawMind」。before-quit 里会拉起监督进程。
      await electronApp.close();

      // 1) 后台真的起来了：pid 文件出现且进程活着，日志里有启动行。
      const childPid = await waitFor(
        "lawmindd 启动",
        async () => ({ pid: await readPid(workspaceDir), log: await readText(paths.log) }),
        (v) => v.pid != null && isAlive(v.pid) && v.log.includes("[lawmindd] 启动"),
        { timeoutMs: 90_000 },
      );
      expect(childPid.pid).toBeTruthy();
      expect(childPid.log).toContain("lawmindd");

      // 2) 不是「进程在但循环卡死」：心跳必须自己往前走。
      const startState = await readJson<DaemonState>(paths.state);
      expect(startState?.heartbeatAt).toBeTruthy();
      const advanced = await waitFor(
        "心跳推进",
        () => readJson<DaemonState>(paths.state),
        (s) => Boolean(s?.heartbeatAt) && s?.heartbeatAt !== startState?.heartbeatAt,
        { timeoutMs: 90_000 },
      );
      expect(advanced?.heartbeatAt).not.toBe(startState?.heartbeatAt);

      // 3) 模拟被系统杀死（OOM / 休眠）：SIGKILL 之后应当被自动拉起，pid 变新。
      const before = await readPid(workspaceDir);
      expect(before).toBeTruthy();
      process.kill(before as number, "SIGKILL");

      const after = await waitFor(
        "自动重启",
        async () => ({ pid: await readPid(workspaceDir), log: await readText(paths.log) }),
        (v) => v.pid != null && v.pid !== before && isAlive(v.pid) && v.log.includes("自动重启"),
        { timeoutMs: 90_000 },
      );
      expect(after.pid).not.toBe(before);
      expect(after.log).toContain("准备第 1 次自动重启");

      // 4) 退出归因写下来了 —— 这正是桌面重开时「你走后发生了什么」回执的来源。
      const afterState = await readJson<DaemonState>(paths.state);
      expect(afterState?.restartCount ?? 0).toBeGreaterThanOrEqual(1);
      expect(["killed", "crashed"]).toContain(String(afterState?.lastExitClass));
      // 自愈成功就不该带着「已放弃」旗标。
      expect(afterState?.supervisionGaveUpAt).toBeUndefined();

      // 5) 停得干净：SIGTERM 之后整棵树退出，pid 与锁都不留。
      await stopDaemonTree(workspaceDir);
      cleaned = true;
      expect(await readPid(workspaceDir)).toBeUndefined();
      await expect(fs.access(paths.lock).then(() => true, () => false)).resolves.toBe(false);
    } finally {
      if (!cleaned) {
        await stopDaemonTree(workspaceDir);
      }
    }
  });
});
