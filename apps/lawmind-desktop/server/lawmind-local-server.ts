/**
 * LawMind local HTTP API for desktop shell (loopback only: 127.0.0.1 + ::1, never LAN).
 *
 * 为什么是两个协议族：`localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，
 * WebKit / Word 任务窗格多半先试 `::1`。只绑 IPv4 会让 `http://localhost:<port>` 直接连不上。
 *
 * Env:
 * - LAWMIND_WORKSPACE_DIR (required)
 * - LAWMIND_DESKTOP_PORT (required)
 * - LAWMIND_ENV_FILE (optional path to .env.lawmind)
 * - LAWMIND_DESKTOP_ACTOR_ID (optional; default `lawyer:desktop`) — audit attribution for desktop review/agent
 * - LAWMIND_ENABLE_COLLABORATION (optional; default enabled) — set `false` to disable multi-assistant collaboration
 *
 * Optional workspace policy: `lawmind.policy.json` in the workspace root (see docs/archive/LAWMIND-POLICY-FILE.md).
 *
 * Run from monorepo root: node --import tsx apps/lawmind-desktop/server/lawmind-local-server.ts
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { installIcloudReadMaterialize } from "../../../src/lawmind/runtime/icloud-materialize.js";
import { bootstrapLawMindDesktopEnv } from "./lawmind-desktop-env-bootstrap.js";
import { restoreDelegationsFromDisk } from "../../../src/lawmind/agent/collaboration/index.js";
import { ensureBuiltinWorkflowSeeds } from "../../../src/lawmind/agent/collaboration/ensure-workflow-seeds.js";
import { startAuditExternalAnchorSync } from "../../../src/lawmind/audit/external-anchor.js";
import { loadAndApplyLawMindPolicy } from "./lawmind-policy.js";
import { corsHeaders, LAWMIND_LOCAL_HOST, LAWMIND_LOCAL_HOST_V6 } from "./lawmind-server-helpers.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import {
  ensureLoopbackBearerToken,
  hasDerivedCredentials,
  initLocalApiCredentialsFromEnv,
  initLoopbackBearerFromEnv,
} from "./lawmind-local-api-auth.js";
import { isShellLaneRequest, registerRateLimitBucket, TokenBucket } from "./lawmind-local-rate-limit.js";
import { getGlobalSseBus } from "./lawmind-sse-bus.js";
import {
  noteUncaughtException,
  noteUnhandledRejection,
} from "./lawmind-process-policy.js";
import {
  enqueueWorkflowRun,
  loadJobsFromDiskOnStartup,
  processDueScheduledJobs,
  setWorkflowJobSchedulerContext,
} from "./lawmind-server-jobs.js";
import { buildAgentConfig } from "./lawmind-server-helpers.js";
import {
  getSearchIndexStatus,
  indexExists,
  syncWorkspaceSearchIndex,
} from "../../../src/lawmind/indexing/index.js";
import { computeSearchIndexFreshness } from "../../../src/lawmind/indexing/fts-search.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import { processDueLawyerAutomations } from "../../../src/lawmind/platform/lawyer-automations-runner.js";
import { processDueDeadlineReminders } from "../../../src/lawmind/desk/deadline-remind.js";
import {
  DAEMON_TICK_INTERVAL_MS,
  acquireDaemonLock,
  clearDaemonPid,
  clearDaemonSupervisionGiveUp,
  getDaemonStatus,
  markDaemonExit,
  markDaemonStarted,
  markDaemonSupervisionGaveUp,
  markDaemonTick,
  releaseDaemonLock,
  stopDaemonProcess,
} from "../../../src/lawmind/platform/lawmind-daemon.js";
import { appendDaemonLogLine } from "../../../src/lawmind/platform/lawmind-daemon-log.js";
import { classifyDaemonExit } from "../../../src/lawmind/platform/lawmind-daemon-supervision.js";
import {
  buildSupervisorChildEnv,
  describeDaemonChildExitForLog,
  runDaemonSupervisorLoop,
} from "./lawmind-daemon-supervisor.js";
import {
  instantiateCollaborationWorkflowFromTemplate,
  readWorkspaceWorkflowTemplate,
} from "../../../src/lawmind/agent/collaboration/workspace-workflow-templates.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isWordAddinAutoRunEnabled } from "../../../src/lawmind/policy/edition.js";
import { listMatterIds as listWorkspaceMatterIds } from "../../../src/lawmind/cases/index.js";
import { tickWordAddinAutoRun, setWordAddinAutoRunWaker } from "./lawmind-server-word-addin-runner.js";
import { startMatterReplicaAutoSync } from "../../../src/lawmind/matter-replica/sync-scheduler.js";
import { setMatterReplicaScheduler } from "./lawmind-server-matter-replica-scheduler.js";
import { syncMatterWithCloud } from "../../../src/lawmind/matter-cloud/index.js";

/** 监督进程把重启次数通过 env 传给子进程，子进程据此写入状态（给律师看的「中断过 N 次」）。 */
function parseRestartCountEnv(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * 退出归因：把「为什么停了」写进状态，桌面重开时如实回执。
 *
 * 挂在 `process.on("exit")` 上而不是各分支里，是因为崩溃路径（uncaughtException、
 * unhandledRejection、以及 Node 自己遇到致命错误）未必经过我们的处理器；
 * exit 处理器只能做同步 I/O，而 `writeDaemonState` 正是同步的。
 */
function installDaemonExitAccounting(workspaceDir: string, isIntentional: () => boolean): void {
  process.on("exit", (code) => {
    try {
      const exitClass = classifyDaemonExit({ code, intentional: isIntentional() });
      markDaemonExit(workspaceDir, { exitClass, detail: `exit_code=${code ?? "unknown"}` });
      appendDaemonLogLine(workspaceDir, exitClass === "stopped" ? "info" : "error", `[lawmindd] 退出 ${exitClass} exit_code=${code ?? "unknown"}`);
      releaseDaemonLock(workspaceDir);
      clearDaemonPid(workspaceDir);
    } catch {
      /* 退出路径永不抛 */
    }
  });
  const recordFatal = (label: string, err: unknown) => {
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
    appendDaemonLogLine(workspaceDir, "error", `[lawmindd] ${label}：${text}`);
    console.error(`[lawmindd] ${label}:`, err);
    // 交给 exit 处理器归因并落盘；这里只负责把它记下来。
    process.exit(1);
  };
  process.on("uncaughtException", (err) => recordFatal("uncaughtException", err));
  process.on("unhandledRejection", (err) => recordFatal("unhandledRejection", err));
}

/**
 * 监督进程：反复把 tick 子进程跑起来，崩了按退避重启。
 *
 * ## 所有权：pid 与锁都归**子进程**，监督进程不持有任何持久状态
 *
 * 踩过的坑（真机 E2E `daemon-supervision.spec.ts` 抓到，单测抓不到）：
 * 最初让监督进程先抢锁再 fork，而子进程也抢同一把锁 —— 子进程必然失败并「让位」，
 * 于是**走生产路径（关窗 → 监督进程）时 lawmindd 从来不 tick**，
 * 「关窗后继续办件」实际是坏的。两个函数各自单测都对，拼起来才错。
 *
 * 现在：互斥唯一由**子进程**的 `acquireDaemonLock` 仲裁（它才是真正的 ticker）。
 * 起两个监督进程也无害——抢到锁的那个负责 tick，另一个的子进程让位、以 0 退出，
 * 其监督进程依 `clean_exit` 收工。代价是多一次 fork，换来的是没有跨进程的双重所有权。
 *
 * 因此监督进程**不**清 pid、**不**放锁：那会把另一棵正在跑的树的状态抹掉。
 *
 * 子进程的 stdout/stderr 被接管并逐行转成带时间戳的日志——不能直接把 fd 指到
 * `daemon.log`，因为轮转之后那个 fd 会一直写到改名后的旧 inode 上。
 */
async function runDaemonSupervisor(workspaceDir: string, envFile: string | undefined): Promise<void> {
  const { spawn } = await import("node:child_process");
  const logLine = (level: "info" | "warn" | "error", message: string) => {
    appendDaemonLogLine(workspaceDir, level, message);
    console.error(`[lawmindd-supervisor] ${message}`);
  };

  let stopping = false;
  let currentChild: import("node:child_process").ChildProcess | null = null;
  const onStop = () => {
    stopping = true;
    currentChild?.kill("SIGTERM");
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  const scriptPath = process.argv[1];
  if (!scriptPath) {
    logLine("error", "找不到要监督的脚本路径，无法启动后台办件。");
    return;
  }

  // 走 buildSupervisorChildEnv 这个唯一过滤器：手写 `{...process.env}`
  // 会把 deny 名单里的凭据根密钥透传给 tick 进程（见 SECURITY.md）。
  const childEnv = buildSupervisorChildEnv(process.env, { workspaceDir, envFile });

  const outcome = await runDaemonSupervisorLoop(
    {
      spawnChild: ({ restartCount }) => {
        let child: import("node:child_process").ChildProcess;
        try {
          child = spawn(process.execPath, [...process.execArgv, scriptPath], {
            cwd: process.cwd(),
            env: {
              ...childEnv,
              LAWMIND_ENV_FILE: envFile ?? "",
              // 子进程据此把「被重启过几次」写进 daemon.json ——
              // 桌面「期间中断过 N 次」的回执唯一来源。
              ...(restartCount > 0
                ? { LAWMIND_DAEMON_RESTART_COUNT: String(restartCount) }
                : {}),
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          // spawn 本身失败也要走同一套退避，不能把异常抛穿监督循环。
          const detail = err instanceof Error ? err.message : String(err);
          logLine("error", `子进程启动失败：${detail}`);
          return { waitForExit: async () => ({ code: 1, signal: null }) };
        }
        currentChild = child;
        attachChildLogTee(child, workspaceDir);
        return {
          waitForExit: () =>
            new Promise((resolve) => {
              child.once("exit", (code, signal) => {
                if (currentChild === child) {
                  currentChild = null;
                }
                resolve({ code, signal });
              });
              child.once("error", (err) => {
                logLine("error", `子进程错误：${err.message}`);
                resolve({ code: 1, signal: null });
              });
            }),
        };
      },
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onChildExit: ({ exitClass, code, signal, restarts }) => {
        logLine(
          exitClass === "crashed" || exitClass === "killed" ? "error" : "info",
          `子进程退出（${exitClass}, ${describeDaemonChildExitForLog({ code, signal })}），累计重启 ${restarts} 次`,
        );
        // **只有非正常退出由监督进程记账。**
        //
        // 必要性：子进程被 SIGKILL 时 `process.on("exit")` 根本不会运行，
        // 它没有机会写下自己的退出记录 —— 而律师最需要看到的正是这类中断
        // （真机 E2E 抓到：自愈成功后 lastExitClass 仍是 undefined）。
        //
        // 只记 crashed/killed：clean/stopped 是正常收工，记下来会让设置页
        // 在每次正常停止后都显示「后台办件自己收工了」，属于虚假告警。
        if (exitClass === "crashed" || exitClass === "killed") {
          markDaemonExit(workspaceDir, {
            exitClass,
            detail: describeDaemonChildExitForLog({ code, signal }),
          });
        }
      },
      onRestartScheduled: ({ attempt, delayMs, reason }) => {
        logLine("warn", `准备第 ${attempt} 次自动重启（原因 ${reason}），等待 ${delayMs}ms`);
      },
      onGiveUp: ({ reason, attempts }) => {
        markDaemonSupervisionGaveUp(workspaceDir, { reason, attempts });
        logLine(
          "error",
          `连续失败 ${attempts} 次后停止重试：这段时间的自动办件没有运行。`,
        );
      },
    },
    { isStopping: () => stopping },
  );

  // 刻意不 clearDaemonPid / releaseDaemonLock：pid 与锁属于子进程。
  // 子进程退出时已自行清理；若它让位给了别的树，这里清就等于抹掉别人。
  logLine("info", `监督进程结束（${outcome.reason}，累计重启 ${outcome.restarts} 次）`);
}

/** 把子进程的原始输出逐行转成带时间戳的日志，避免轮转后 fd 指向旧 inode。 */
function attachChildLogTee(
  child: import("node:child_process").ChildProcess,
  workspaceDir: string,
): void {
  const tee = (stream: NodeJS.ReadableStream | null, level: "info" | "error") => {
    if (!stream) {
      return;
    }
    const streamRef = stream;
    let partial = "";
    streamRef.setEncoding?.("utf8");
    streamRef.on("data", (chunk: string) => {
      const text = partial + chunk;
      const lines = text.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() !== "") {
          appendDaemonLogLine(workspaceDir, level, line);
        }
      }
    });
  };
  tee(child.stdout, "info");
  tee(child.stderr, "error");
}

async function main() {
  installIcloudReadMaterialize();
  const daemonMode = process.env.LAWMIND_DAEMON === "1";
  const supervisorMode = process.env.LAWMIND_DAEMON_SUPERVISOR === "1";
  const workspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  const portRaw = process.env.LAWMIND_DESKTOP_PORT?.trim();
  const envFileRaw = process.env.LAWMIND_ENV_FILE?.trim();
  const envFile = envFileRaw || undefined;
  /** 由 SIGTERM/SIGINT 处理器置位，供退出归因区分「正常停止」与「崩溃」。 */
  let exitIntentional = false;

  const headlessMode = daemonMode || supervisorMode;
  if (!workspaceDir || (!headlessMode && !portRaw)) {
    console.error("LAWMIND_WORKSPACE_DIR and LAWMIND_DESKTOP_PORT are required");
    process.exit(1);
  }

  const port = Number(portRaw);
  if (!headlessMode && (!Number.isFinite(port) || port < 1 || port > 65535)) {
    console.error("Invalid LAWMIND_DESKTOP_PORT");
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });

  // 监督进程只做一件事：把 tick 子进程跑起来、崩了按退避重启、写日志与状态。
  // 必须在任何重活（seed / 加载 jobs / 读密钥）之前分支，否则监督进程会重复
  // 干一遍子进程的活，并且持有两份状态。
  if (supervisorMode) {
    await runDaemonSupervisor(workspaceDir, envFile);
    return;
  }

  if (!daemonMode) {
    try {
      stopDaemonProcess(workspaceDir);
    } catch {
      /* desktop owns ticks while the window is open */
    }
  }

  if (daemonMode) {
    // 抢锁才是互斥依据：pid 文件的「读→判→写」之间有竞态。
    const lock = acquireDaemonLock(workspaceDir);
    if (!lock.acquired) {
      const detail = lock.reason === "held" ? `pid=${lock.heldBy ?? "unknown"}` : lock.detail;
      appendDaemonLogLine(workspaceDir, "info", `[lawmindd] 已在运行，本进程让位（${detail}）`);
      console.error(`[lawmindd] already running (${detail})`);
      process.exit(0);
    }
    const restartCount = parseRestartCountEnv(process.env.LAWMIND_DAEMON_RESTART_COUNT);
    markDaemonStarted(workspaceDir, process.pid, { restartCount });
    // 有 ticker 真的跑起来了，就说明「重试已耗尽」的旧结论过期了；
    // 否则桌面会一边显示「已停止重试、没有运行」，一边实际在办件。
    clearDaemonSupervisionGiveUp(workspaceDir);
    appendDaemonLogLine(
      workspaceDir,
      "info",
      `[lawmindd] 启动 pid=${process.pid}${restartCount > 0 ? `（第 ${restartCount} 次自动重启）` : ""}`,
    );

    installDaemonExitAccounting(workspaceDir, () => exitIntentional);
    const stop = () => {
      exitIntentional = true;
      if (getDaemonStatus(workspaceDir).pid === process.pid) {
        clearDaemonPid(workspaceDir);
      }
      releaseDaemonLock(workspaceDir);
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
  // 作业标准在安装包的 builtin/ 里，启动不往工作区抄 SKILL.md。
  const { userEnvPath } = bootstrapLawMindDesktopEnv({
    workspaceDir,
    envFile,
    repoRoot: process.env.LAWMIND_REPO_ROOT,
  });

  const wfSeed = ensureBuiltinWorkflowSeeds(workspaceDir);
  if (wfSeed.created.length > 0) {
    console.error(
      `[lawmind-local-server] seeded workflow templates: ${wfSeed.created.join(", ")}`,
    );
  }
  // 桌面端默认开启全轮次 token 流式，便于对话区展示模型真实输出（Cursor 式）
  if (!process.env.LAWMIND_STRICT_TOOL_STREAM?.trim()) {
    process.env.LAWMIND_STRICT_TOOL_STREAM = "0";
  }

  const policy = loadAndApplyLawMindPolicy(workspaceDir);

  restoreDelegationsFromDisk(workspaceDir);
  loadJobsFromDiskOnStartup(workspaceDir);

  setWorkflowJobSchedulerContext((ws) => {
    const built = buildAgentConfig(ws, { envFile });
    return built.config ?? null;
  });
  const tickScheduled = () => {
    try {
      processDueScheduledJobs(workspaceDir);
    } catch {
      /* best-effort */
    }
    try {
      const built = buildAgentConfig(workspaceDir, { envFile });
      const config = built.config;
      void processDueLawyerAutomations(workspaceDir, {
        envFile,
        lawMindRoot: resolveLawMindRoot(workspaceDir, envFile),
        enqueueTemplate: ({ templateId, matterId, instruction, automationId }) => {
          if (!config) {
            return null;
          }
          ensureBuiltinWorkflowSeeds(workspaceDir);
          const template = readWorkspaceWorkflowTemplate(workspaceDir, templateId);
          if (!template) {
            return null;
          }
          const workflow = instantiateCollaborationWorkflowFromTemplate(template, {
            matterId,
            createdBy: "lawyer_automation",
            vars: instruction?.trim()
              ? { instruction: instruction.trim(), automationId }
              : { automationId },
          });
          return enqueueWorkflowRun(config, workflow, {
            templateId,
            workflowVars: instruction?.trim()
              ? { instruction: instruction.trim(), automationId }
              : { automationId },
            idempotencyKey: `automation:${automationId}:${new Date().toISOString().slice(0, 13)}`,
          });
        },
      }).catch((err) => {
        console.error(
          "[lawmind-local-server] automations tick failed:",
          err instanceof Error ? err.message : err,
        );
      });
    } catch {
      /* best-effort */
    }
    try {
      processDueDeadlineReminders(workspaceDir);
    } catch {
      /* best-effort */
    }
    tickWordAddin();
  };

  /**
   * Word 插件自动取件：按 tick 领一条 queued 请求跑固定流水线。
   * 开关关闭时不再领新请求（人工档行为不变），但仍会清理卡住的孤儿运行——
   * 否则律师在跑的过程中关掉开关，那条请求会永远停在「正在审查…」。
   */
  const tickWordAddin = (): void => {
    try {
      const config = buildAgentConfig(workspaceDir, { envFile }).config;
      const enabled = isWordAddinAutoRunEnabled({ policy: readWorkspacePolicyFile(workspaceDir) });
      void tickWordAddinAutoRun({
        workspaceDir,
        autoRunEnabled: enabled && Boolean(config),
        actorId: config?.actorId ?? "lawyer:desktop",
        listMatterIds: () => listWorkspaceMatterIds(workspaceDir),
        enqueue: ({ workflow, requestId, grantedDir }) => {
          if (!config) {
            return null;
          }
          // 源文件可能在工作区外（桌面/下载目录）：把它的目录作为本次运行的本机文件夹，
          // 之后 render_tracked_draft 才能读写源文件同目录。仅本次运行，不落常驻授权。
          const runConfig = grantedDir ? { ...config, projectDir: grantedDir } : config;
          return enqueueWorkflowRun(runConfig, workflow, {
            idempotencyKey: `word-addin:${requestId}`,
          });
        },
      });
    } catch {
      /* best-effort：插件侧零影响 */
    }
  };
  setWordAddinAutoRunWaker(() => {
     tickWordAddin();
  });
  const autoRebuildSearchIndexIfStale = () => {
    try {
      // policy 门禁（默认关）：searchIndexAutoRebuild=true 才在后台把改过的文件补进索引。
      // 律师检索本身会增量同步，不依赖这个开关，也不再按 24 小时整库重建。
      const policy = readWorkspacePolicyFile(workspaceDir);
      if (policy?.searchIndexAutoRebuild !== true) {
        return;
      }
      const status = getSearchIndexStatus(workspaceDir);
      if (!computeSearchIndexFreshness(status).stale) {
        return;
      }
      void syncWorkspaceSearchIndex(workspaceDir).catch(() => {
        /* best-effort */
      });
    } catch {
      /* best-effort */
    }
  };

  const tickScheduledWithIndex = () => {
    tickScheduled();
    if (daemonMode) {
      try {
        markDaemonTick(workspaceDir);
      } catch {
        /* best-effort */
      }
    }
    autoRebuildSearchIndexIfStale();
  };
  tickScheduledWithIndex();
  const scheduleTimer = setInterval(tickScheduledWithIndex, DAEMON_TICK_INTERVAL_MS);
  // daemon 模式下这个定时器是**唯一的存活句柄**：unref 掉之后事件循环随即空掉，
  // 进程启动完就自己退出，「关窗后继续办件」随之彻底失效
  // （真机 E2E `daemon-supervision.spec.ts` 抓到：日志里 `[lawmindd] 启动` 之后
  // 紧跟 `退出 clean exit_code=0`，监督进程看到 clean_exit 也就收工了）。
  // 桌面模式下 HTTP server 会撑住事件循环，仍保持 unref 以便干净退出。
  if (!daemonMode) {
    scheduleTimer.unref?.();
  }

  // 案件副本自动同步（Firm/Private 默认开，Solo 关闭）：同事丢进的材料不用手点就会出现。
  const replicaAutoSync = startMatterReplicaAutoSync({
    workspaceDir,
    // 云感知：自动同步也要把云侧名册拉成本地投影并补发钥匙，否则新成员要等手动同步
    sync: async (ws, matterId) => {
      const r = await syncMatterWithCloud(ws, matterId);
      return {
        pulled: r.sync.pulled,
        applied: { locks: r.sync.applied.locks, members: r.sync.applied.members },
        materials: {
          downloadedFiles: r.sync.materials.downloadedFiles,
          deletedLocally: r.sync.materials.deletedLocally,
          rejectedIntegrity: r.sync.materials.rejectedIntegrity,
        },
      };
    },
    onOutcome: (o) => {
      if (!o.ok) {
        console.error(
          `[lawmind-local-server] 案件副本自动同步失败 matter=${o.matterId}: ${o.error ?? "unknown"}`,
        );
      }
    },
  });
  setMatterReplicaScheduler(replicaAutoSync);

  const externalAnchorUrl = process.env.LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL?.trim();
  if (externalAnchorUrl) {
    // 每日同步最新审计摘要到外部锚；emit 路径已实时触发，此定时器覆盖静默日。
    const anchorSync = startAuditExternalAnchorSync(
      path.join(workspaceDir, "audit"),
      externalAnchorUrl,
    );
    anchorSync.syncNow().catch(() => {
      /* 失败只告警，不阻断启动 */
    });
  }

  const rebuildMissingSearchIndex = (): void => {
    if (!indexExists(workspaceDir)) {
      void syncWorkspaceSearchIndex(workspaceDir).catch(() => {
        /* best-effort background index */
      });
    }
  };

  if (daemonMode) {
    // 守护进程不起 HTTP，缺索引要在这里补。桌面进程改到 listen 成功之后，避免挡在端口前面。
    rebuildMissingSearchIndex();
    console.error(`[lawmindd] workspace=${workspaceDir} pid=${process.pid}`);
    return;
  }

  initLoopbackBearerFromEnv();
  initLocalApiCredentialsFromEnv();
  if (!process.env.LAWMIND_LOCAL_API_TOKEN?.trim() && !hasDerivedCredentials()) {
    ensureLoopbackBearerToken();
  }

  const ctx = { workspaceDir, envFile, userEnvPath, policy, sseBus: getGlobalSseBus() };
  const rateBucket = new TokenBucket({ rate: 100, capacity: 200 });
  registerRateLimitBucket(rateBucket);

  // 两个监听（IPv4 / IPv6 回环）共用同一个 handler 与同一个限流桶。
  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const pathname = (req.url ?? "/").split("?")[0] || "/";
    if (!isShellLaneRequest(req.method, pathname) && !rateBucket.tryConsume(1)) {
      // 限流响应也要带 CORS 头，否则浏览器侧拿不到错误体（只看到网络错误）。
      res.writeHead(429, { "content-type": "application/json", ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: false, error: "rate_limited", code: "rate_limited" }));
      return;
    }
    void lawmindHandleHttpRequest(ctx, req, res);
  };

  const tuneLoopbackServer = (httpServer: http.Server): void => {
    // 默认 keep-alive 只有 5 秒。切对话 / 工作台 / 在办时连接已经拆掉，每次都要重新握手。
    // 拉长到一分钟，让界面切换复用同一条回环连接。headersTimeout 必须大于 keepAliveTimeout。
    httpServer.keepAliveTimeout = 65_000;
    httpServer.headersTimeout = 70_000;
  };

  const server = http.createServer(handleRequest);
  tuneLoopbackServer(server);
  server.on("error", (err) => {
    // 端口被占时必须在这里退出。没有监听的话 Node 会当成 uncaughtException，
    // 体检把「端口冲突」记成进程已损坏。
    console.error(
      `[lawmind-local-server] IPv4 回环监听失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
  // `localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，WebKit（Word 任务窗格）多半先试 `::1`。
  // 只绑 IPv4 时，用 `http://localhost:<port>` 打开的客户会连不上，Word 里报「无法加载该加载项」。
  // 所以同一个 handler 再挂一个 IPv6 回环监听；仍是回环，不对局域网暴露。
  const serverV6 = http.createServer(handleRequest);
  tuneLoopbackServer(serverV6);
  serverV6.on("error", (err) => {
    // best-effort：内核无 IPv6、端口被占、权限不足都不该阻断主服务启动。
    console.error(
      `[lawmind-local-server] IPv6 回环监听失败（主服务不受影响）: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  server.listen(port, LAWMIND_LOCAL_HOST, () => {
    console.error(`[lawmind-local-server] http://${LAWMIND_LOCAL_HOST}:${port} workspace=${workspaceDir}`);
    rebuildMissingSearchIndex();
  });
  serverV6.listen(port, LAWMIND_LOCAL_HOST_V6, () => {
    console.error(
      `[lawmind-local-server] http://[${LAWMIND_LOCAL_HOST_V6}]:${port} (IPv6 回环，供 localhost 解析) workspace=${workspaceDir}`,
    );
  });
}

process.on("uncaughtException", (err) => {
  console.error("[lawmind-local-server] uncaughtException:", err);
  noteUncaughtException();
  // 状态可能已损坏：记录后干净退出，交给 Electron 监督层指数退避重启
  // （取舍说明见 lawmind-process-policy.ts 顶部）。
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  // 可用性优先的故意取舍：记录 + 计入健康信号（doctor.process.degraded），不退出。
  console.error("[lawmind-local-server] unhandledRejection:", reason);
  noteUnhandledRejection();
});

void main();
