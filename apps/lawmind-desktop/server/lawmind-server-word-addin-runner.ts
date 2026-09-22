/**
 * Word 插件自动取件（桌面端服务侧）。
 *
 * 律师在 Word 里点「审这份」只登记一条请求；**不需要**再回桌面端点一次。
 * 本地服务按 tick 取件，把 `queued` 变成 `running` 并交给固定流水线，
 * 渲染完成后 `attach-result.ts` 已会自动回填，插件轮询到 `ready` 即可就地落改。
 *
 * 四条安全线：
 * - 只跑 `autoRunEnabled`（edition `wordAddinAutoRun` / policy）开启时；关闭即退回原人工档，行为逐字不变。
 * - 串行：一次只领一条，避免两条请求争同一个 draft。
 * - 过期不跑：取件时比对内容指纹，文件已改动就转 `stale`，不用旧基线出稿。
 * - 案卷不猜：对不唯一就转 `needs_matter`，让律师在 Word 窗格里选。
 */

import fs from "node:fs";
import {
  claimWordAddinReviewForRun,
  fingerprintWordFile,
  isWordAddinActiveState,
  listWordAddinReviewsByState,
  supersedeSiblingWordAddinReviews,
  updateWordAddinReview,
  type WordAddinReviewRequest,
} from "../../../src/lawmind/integrations/word-addin/review-requests.js";
import {
  buildWordAddinRedlineInstruction,
  buildWordAddinRedlineWorkflow,
  buildWordAddinRunAuthorization,
  needsHostDirGrant,
  resolveWordAddinMatterForSource,
} from "../../../src/lawmind/integrations/word-addin/auto-run.js";
import {
  getWorkflowJob as defaultGetWorkflowJob,
  isTerminalWorkflowJobStatus,
} from "./lawmind-server-jobs.js";

/** 孤儿判定的最小信息（便于纯测试注入，不依赖 jobs 注册表）。 */
export type WordAddinJobSnapshot = { status: string; error?: string; stepError?: string };

export type WordAddinAutoRunDeps = {
  workspaceDir: string;
  /** 由本地服务注入：把固定流水线入队，返回 jobId（失败返回 null）。 */
  enqueue: (args: {
    workflow: ReturnType<typeof buildWordAddinRedlineWorkflow>;
    /**
     * 案卷 id；**对不到案卷时是 `undefined`（ad-hoc 直跑）**——这不是错误分支。
     * 窗格对任何文件夹都得能操作，改稿链本身不需要案卷（见 `auto-run.ts` 的
     * `resolveWordAddinMatterResolution` 说明）。`WordAddinAutoRunOutcome` 的
     * `enqueued` 分支同样声明为 `string | undefined`，两处一致。
     *
     * 此前这里写成 `string`：类型比现实窄（本地服务那侧根本没读这个字段）。
     */
    matterId: string | undefined;
    requestId: string;
    /** 本次运行授予的本机目录（= 源文件所在目录）；服务据此设 projectDir。 */
    grantedDir: string;
  }) => string | null;
  /**
   * 工作区案卷 id 列表。
   *
   * 必须用 `cases/index.ts` 的 `listMatterIds`（== 桌面「本案列表」同一份真相，
   * 并集 `matters/` 存储 + `cases/` 文件夹 + 任务归属），而不是只读 `matters/`：
   * 真机上 `cases/demo-matter-001/` 这类只有文件夹、没有 `matters/<id>/matter.json`
   * 的案卷很常见，只读存储会让它既推断不出、又在下拉里选不到 → 律师彻底卡住。
   */
  listMatterIds: () => Promise<string[]> | string[];
  actorId: string;
  /** false 时不再领取新请求：老的人工档行为逐字保持不变（但孤儿运行仍会被清理）。 */
  autoRunEnabled: boolean;
  /** 查询工作流任务状态；默认走本地服务 jobs 注册表。 */
  getJob?: (jobId: string) => WordAddinJobSnapshot | undefined;
  now?: () => Date;
};

export type WordAddinAutoRunOutcome =
  | { requestId: string; result: "enqueued"; jobId: string; matterId: string | undefined }
  | { requestId: string; result: "stale" }
  | { requestId: string; result: "failed"; error: string }
  | { requestId: string; result: "reconciled"; reason: string }
  | { requestId: string; result: "skipped"; reason: string };

export type WordAddinAutoRunReport = {
  picked: number;
  outcomes: WordAddinAutoRunOutcome[];
};

/**
 * `jobId` 记录被清掉（注册表只留最近 200 条）时靠时间兜底判孤儿。
 * 给足余量：真跑一次合同改稿通常几分钟，不该被误判。
 */
export const WORD_ADDIN_RUN_ORPHAN_MS = 30 * 60 * 1000;

/**
 * 清理「卡在 `running`」的请求。
 *
 * 为什么必须有这一步：结果回填发生在 `render_tracked_draft` 工具内部
 * （`attachWordAddinResultSafely`），任务失败/取消/降级导出时那次回填不会发生。
 * 没有清理，请求就永远停在 `running`，插件一路轮询到 5 分钟上限才放弃，
 * 而律师只看到「桌面端正在审查…」——这是在说谎。
 *
 * 判定（都要求请求已不在推进）：
 * - 任务终态且不是 completed → 如实写失败原因；
 * - 任务是 completed 却仍是 `running` → 引擎刻意不回填（如降级导出），如实说明；
 * - 任务记录不见了且已过 `WORD_ADDIN_RUN_ORPHAN_MS` → 按记录丢失处理；
 * - 领了却没记下 jobId（在 enqueue 与写盘之间被杀）→ 按中断处理。
 */
export async function reconcileStalledWordAddinRuns(deps: {
  workspaceDir: string;
  getJob?: (jobId: string) => WordAddinJobSnapshot | undefined;
  now?: Date;
}): Promise<WordAddinAutoRunOutcome[]> {
  const now = deps.now ?? new Date();
  const nowMs = now.getTime();
  const getJob =
    deps.getJob ??
    ((jobId: string): WordAddinJobSnapshot | undefined => {
      const rec = defaultGetWorkflowJob(jobId);
      if (!rec) {
        return undefined;
      }
      // 步骤级报错比 job 级更具体：单一 redline 步骤失败时 job.error 可能为空。
      const stepError = rec.result?.steps?.find((s) => s.error?.trim())?.error;
      return {
        status: rec.status,
        ...(rec.error ? { error: rec.error } : {}),
        ...(stepError ? { stepError } : {}),
      };
    });
  const running = listWordAddinReviewsByState(deps.workspaceDir, "running");
  const outcomes: WordAddinAutoRunOutcome[] = [];
  for (const row of running) {
    const jobId = row.jobId?.trim();
    let reason: string;
    let note: string;
    if (!jobId) {
      reason = "run_interrupted";
      note = "桌面端在启动这次审查时中断了（可能重启过）。请重新点「审这份」。";
    } else {
      const job = getJob(jobId);
      if (!job) {
        const startedMs = Date.parse(row.authorization?.at ?? row.updatedAt);
        if (!Number.isFinite(startedMs) || nowMs - startedMs <= WORD_ADDIN_RUN_ORPHAN_MS) {
          continue; // 还在跑，只是任务记录暂时查不到
        }
        reason = "job_record_missing";
        note = "找不到这次的审查任务记录（可能已被清理）。请重新点「审这份」。";
      } else if (job.status === "completed") {
        // 真机实测这条最常见的真因是**模型调用失败**（如 key 失效 401）——引擎会把
        // 「本轮模型调用失败：…」当成一次成功的步骤结果，job 状态仍是 completed。
        // 所以这里不能只写「降级导出」那一类原因，否则窗格会把人往错方向带。
        reason = "completed_without_result";
        const detail = job.stepError?.trim();
        note =
          "桌面端这一轮结束了，但没有可回填的 Word 修订轨。常见原因：模型调用失败（如 API Key 失效）、"
          + "降级导出、或本轮没有需要落改的锚点。请到桌面端看这次审查的结果。"
          + (detail ? `（任务报错：${detail.slice(0, 160)}）` : "");
      } else if (isTerminalWorkflowJobStatus(job.status)) {
        reason = `job_${job.status}`;
        const detail = job.error?.trim() ?? "";
        note = `桌面端这次审查${job.status === "cancelled" ? "被取消" : "失败"}：${
          humanizeWordAddinJobError(detail) || "未写明原因"
        }。请重新点「审这份」，或到桌面端看详情。`;
      } else {
        continue; // queued / running / scheduled：还在跑
      }
    }
    await updateWordAddinReview(deps.workspaceDir, row.id, {
      state: "failed",
      error: reason,
      note,
    });
    outcomes.push({ requestId: row.id, result: "reconciled", reason });
  }
  return outcomes;
}

/**
 * 把引擎的机器码翻成律师能读懂的一句话。
 *
 * 真机上这些码会直接出现在窗格里（例如重启把在跑的 job 标成 `interrupted_by_restart`），
 * 原样丢给律师等于没解释。认不出的码原样返回，不假装懂。
 */
export function humanizeWordAddinJobError(detail: string): string {
  const raw = detail.trim();
  if (!raw) {
    return "";
  }
  const zh: Record<string, string> = {
    interrupted_by_restart: "桌面端中途重启过，这次审查被中断",
    cancelled_by_user: "你取消了这次审查",
    workflow_cancelled: "这次审查被取消",
    missing_workflow_snapshot: "任务记录不完整（缺少流程定义），请重试",
    source_file_missing: "源文件已被移动或删除",
    enqueue_unavailable: "桌面端尚未就绪（模型或工作流入队不可用）",
  };
  return zh[raw] ?? raw;
}

/**
 * 一次 tick 最多领一条（串行）。返回本轮结果，便于测试与日志。
 *
 * 先清理孤儿运行（即使开关关闭也做），再决定要不要领新的请求。
 */
export async function processOneQueuedWordAddinReview(
  deps: WordAddinAutoRunDeps,
): Promise<WordAddinAutoRunReport> {
  const now = deps.now?.() ?? new Date();
  const reconciled = await reconcileStalledWordAddinRuns({
    workspaceDir: deps.workspaceDir,
    ...(deps.getJob ? { getJob: deps.getJob } : {}),
    now,
  });
  if (!deps.autoRunEnabled) {
    return { picked: reconciled.length, outcomes: reconciled };
  }
  // 先点先审，律师的等待可预期。存储是「新在前」，先倒成「旧在前」再按时间升序，
  // 这样同一毫秒内连点的两条也有确定次序（稳定排序保留插入先后），不会随排序实现漂移。
  const queued = listWordAddinReviewsByState(deps.workspaceDir, "queued")
    .toReversed()
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const request = queued[0];
  if (!request) {
    return { picked: reconciled.length, outcomes: reconciled };
  }
  /** 本轮结果 = 清理掉的孤儿 + 这次的动作，两个都不能丢。 */
  const report = (outcomes: WordAddinAutoRunOutcome[]): WordAddinAutoRunReport => ({
    picked: reconciled.length + outcomes.length,
    outcomes: [...reconciled, ...outcomes],
  });

  // 文件没了就别跑：如实回报，比出一个空修订稿诚实。
  if (!fs.existsSync(request.sourcePath)) {
    await updateWordAddinReview(deps.workspaceDir, request.id, {
      state: "failed",
      note: "这份 Word 文件已不在原路径（被移动/删除/改名）。请在 Word 里重新点「审这份」。",
      error: "source_file_missing",
    });
    return report([{ requestId: request.id, result: "failed", error: "source_file_missing" }]);
  }

  const matter = resolveWordAddinMatterForSource({
    workspaceDir: deps.workspaceDir,
    sourceAbs: request.sourcePath,
    matterIds: await deps.listMatterIds(),
    ...(request.matterId ? { requestedMatterId: request.matterId } : {}),
  });
  const matterId = matter.matterId;
  if (!matterId) {
    // ad-hoc：对不到案卷也照跑。律师要的是「任何文件夹打开就能操作」，
    // 改稿链本身不需要案卷（见 resolveWordAddinMatterForSource 说明）。
    // 候选列表留给窗格做「可选记到案卷」。
    //
    // `candidates` **只存在于 adhoc 变体**，而 TS 不会把 `!matterId` 的收窄传给 `matter`
    // （两者是不同变量）。所以这里用判别字段再收窄一次；外层条件保持不变，
    // 语义与改造前逐字相同（不用 `!matterId` 换成 `source === "adhoc"` 改写，
    // 是为了不引入「matterId 为空串」这种边界下的行为差异）。
    await updateWordAddinReview(deps.workspaceDir, request.id, {
      matterCandidates: matter.source === "adhoc" ? matter.candidates : [],
    });
  }

  const fingerprint = fingerprintWordFile(request.sourcePath);
  // 只有工作区外的文件才需要「本机目录授权」；工作区内文件不额外挂载（见 needsHostDirGrant）。
  const grantedDir = needsHostDirGrant(deps.workspaceDir, request.sourcePath)
    ? dirnameOf(request.sourcePath)
    : "";
  const claimed = claimWordAddinReviewForRun({
    workspaceDir: deps.workspaceDir,
    id: request.id,
    authorization: buildWordAddinRunAuthorization({
      request,
      actorId: deps.actorId,
      clientId: request.clientId,
      matterId,

      sourceHash: fingerprint?.hash ?? request.sourceHash ?? "",
      grantedDir,
      at: now,
    }),
    ...(fingerprint ? { fingerprint } : {}),
    at: now,
  });
  if (!claimed.ok) {
    // claim 内部已把 stale 写盘；其余是「别人领走了/状态变了」，都不用再动。
    return report([
      claimed.reason === "stale"
        ? { requestId: request.id, result: "stale" }
        : { requestId: request.id, result: "skipped", reason: claimed.reason },
    ]);
  }

  // 这次跑的就是「这份文件 + 这条指令」：同口径的**还没开跑**的请求共用结果。
  supersedeSiblingWordAddinReviews(deps.workspaceDir, claimed.request, now.getTime());

  const workflow = buildWordAddinRedlineWorkflow({
    workflowId: `word-addin-${request.id}`,
    matterId,

    instruction: buildWordAddinRedlineInstruction({
      sourceAbs: claimed.request.sourcePath,
      matterId,

      instruction: claimed.request.instruction,
    }),
    at: now,
  });

  let jobId: string | null = null;
  try {
    jobId = deps.enqueue({
      workflow,
      matterId,

      requestId: request.id,
      // 与授权留痕同一个值：不该出现「审计说没授权、实际却挂了目录」。
      grantedDir,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWordAddinReview(deps.workspaceDir, request.id, {
      state: "failed",
      error: "enqueue_failed",
      note: `桌面端未能启动审查：${message.slice(0, 200)}`,
    });
    return report([{ requestId: request.id, result: "failed", error: message }]);
  }
  if (!jobId) {
    await updateWordAddinReview(deps.workspaceDir, request.id, {
      state: "failed",
      error: "enqueue_unavailable",
      note: "桌面端尚未就绪（模型或工作流入队不可用）。请在桌面端确认设置后重试。",
    });
    return report([{ requestId: request.id, result: "failed", error: "enqueue_unavailable" }]);
  }

  await updateWordAddinReview(deps.workspaceDir, request.id, { jobId });
  return report([
    { requestId: request.id, result: "enqueued", jobId, matterId },
  ]);
}

function dirnameOf(abs: string): string {
  const idx = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
  return idx > 0 ? abs.slice(0, idx) : abs;
}

/** 模块级串行闸：同一进程内不会同时有两条取件在跑。 */
let inFlight: Promise<WordAddinAutoRunReport> | null = null;

/**
 * tick 入口（fire-and-forget）。已有取件在跑就直接返回，不排队堆积。
 */
export function tickWordAddinAutoRun(deps: WordAddinAutoRunDeps): Promise<WordAddinAutoRunReport> {
  if (inFlight) {
    return Promise.resolve({ picked: 0, outcomes: [] });
  }
  const run = processOneQueuedWordAddinReview(deps)
    .catch((err): WordAddinAutoRunReport => {
      console.error(
        "[lawmind-local-server] word-addin auto-run failed:",
        err instanceof Error ? err.message : err,
      );
      return { picked: 0, outcomes: [] };
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

/** 测试用：清掉串行闸，避免用例间串状态。 */
export function resetWordAddinAutoRunForTests(): void {
  inFlight = null;
}

/**
 * 本地服务在启动时注册「wake」回调（即它的取件 tick）。
 * 插件 POST 新请求后立刻 wake 一次，律师不用等下一个 30s tick。
 */
let wakeFn: (() => void) | undefined;

export function setWordAddinAutoRunWaker(fn: () => void): void {
  wakeFn = fn;
}

/** fire-and-forget；没有注册 waker（纯测试/无桌面端）时静默返回。 */
export function wakeWordAddinAutoRun(): void {
  try {
    wakeFn?.();
  } catch {
    /* best-effort */
  }
}

/** 让插件能区分「在自动跑」和「律师连点被折叠」。 */
export function summarizeWordAddinQueue(rows: WordAddinReviewRequest[]): {
  active: number;
  superseded: number;
  needsMatter: number;
} {
  let active = 0;
  let superseded = 0;
  let needsMatter = 0;
  for (const row of rows) {
    if (isWordAddinActiveState(row.state)) {
      active += 1;
    } else if (row.state === "superseded") {
      superseded += 1;
    } else if (row.state === "needs_matter") {
      needsMatter += 1;
    }
  }
  return { active, superseded, needsMatter };
}
