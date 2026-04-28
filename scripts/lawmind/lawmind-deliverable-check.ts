/**
 * lawmind-deliverable-check — CLI for the Acceptance Gate.
 *
 * Use cases:
 *   - 律师 / QA 在终端快速跑一份 draft 是否「可交付」：
 *       pnpm lawmind:gate -- --task <taskId>
 *   - CI 把它当作 lint：所有 drafted 状态草稿必须 ready=true：
 *       pnpm lawmind:gate -- --all --strict
 *
 * 输出：
 *   - 默认：人类可读 markdown 风格清单
 *   - --json：机器可读 AcceptanceReport[]
 *
 * 退出码：
 *   - 0：所有目标 draft ready=true（或无目标可检）
 *   - 1：至少一份 draft ready=false（仅在 --strict 时返回非零）
 *   - 2：参数/IO 错误
 */

import path from "node:path";
import {
  listDeliverableSpecs,
  loadWorkspaceDeliverableSpecs,
  registerExtraDeliverableSpecs,
  validateDraftAgainstSpec,
} from "../../src/lawmind/deliverables/index.js";
import type { AcceptanceReport } from "../../src/lawmind/deliverables/index.js";
import { buildDraftAcceptancePackMarkdown } from "../../src/lawmind/delivery/draft-acceptance-pack.js";
import { readDraft } from "../../src/lawmind/drafts/index.js";
import { listTaskRecords } from "../../src/lawmind/tasks/index.js";
import type { ArtifactDraft, TaskRecord } from "../../src/lawmind/types.js";

type Args = {
  workspaceDir: string;
  taskIds: string[];
  all: boolean;
  json: boolean;
  strict: boolean;
  listSpecs: boolean;
  packTaskId?: string;
};

function parseArgs(argv: string[]): Args {
  let workspaceDir = path.resolve(process.cwd(), "workspace");
  const taskIds: string[] = [];
  let all = false;
  let json = false;
  let strict = false;
  let listSpecs = false;
  let packTaskId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--workspace" && argv[i + 1]) {
      workspaceDir = path.resolve(argv[++i]);
    } else if (a === "--task" && argv[i + 1]) {
      taskIds.push(argv[++i]);
    } else if (a === "--all") {
      all = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--strict") {
      strict = true;
    } else if (a === "--specs") {
      listSpecs = true;
    } else if (a === "--pack" && argv[i + 1]) {
      packTaskId = argv[++i];
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return { workspaceDir, taskIds, all, json, strict, listSpecs, packTaskId };
}

function printHelp(): void {
  console.log(
    `lawmind-deliverable-check
  --task <id>      检查指定任务（可重复）
  --all            检查工作区里所有 drafted/reviewed 任务
  --workspace <p>  指定工作区目录（默认 ./workspace）
  --json           输出机器可读 JSON
  --strict         任意一份 ready=false 时退出码 1
  --specs          打印内置 + 工作区扩展交付物规格清单后退出
  --pack <taskId>  生成单份草稿的「交付验收包」Markdown 输出到 stdout
  -h, --help       打印帮助`,
  );
}

function pickDrafts(
  workspaceDir: string,
  args: Args,
): Array<{ task: TaskRecord; draft: ArtifactDraft }> {
  const tasks = listTaskRecords(workspaceDir);
  const wanted = new Set(args.taskIds);
  const candidates = args.all
    ? tasks
    : args.taskIds.length > 0
      ? tasks.filter((t) => wanted.has(t.taskId))
      : tasks.filter((t) => t.status === "drafted" || t.status === "reviewed");

  const drafts: Array<{ task: TaskRecord; draft: ArtifactDraft }> = [];
  for (const t of candidates) {
    const draft = readDraft(workspaceDir, t.taskId);
    if (draft) {
      drafts.push({ task: t, draft });
    }
  }
  return drafts;
}

function formatHuman(report: AcceptanceReport, draft: ArtifactDraft): string {
  const head = `## ${draft.title}  [${draft.taskId}]`;
  const status = report.ready ? "READY" : "NOT READY";
  const meta = [
    `- 类型：${report.deliverableType ?? "(unspecified)"}`,
    `- 验收：${status}（blockers=${report.blockerCount}, warnings=${report.warningCount}, placeholders=${report.placeholderCount}）`,
  ].join("\n");

  const checkLines = report.checks.map((c) => {
    const sym = c.passed ? "[x]" : c.severity === "blocker" ? "[!]" : "[~]";
    const hint = c.hint ? ` — ${c.hint}` : "";
    return `  ${sym} (${c.severity}) ${c.label}${hint}`;
  });

  const placeholderHint =
    report.placeholderSamples.length > 0
      ? `- 占位样例：${report.placeholderSamples.join(", ")}`
      : undefined;

  return [head, meta, ...checkLines, placeholderHint].filter(Boolean).join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // 工作区扩展规范：与 engine bootstrap 行为一致，CLI 也能识别事务所私有交付物。
  const wsSpecs = loadWorkspaceDeliverableSpecs(args.workspaceDir);
  if (wsSpecs.specs.length > 0) {
    registerExtraDeliverableSpecs(wsSpecs.specs);
  }
  if (wsSpecs.warnings.length > 0 && !args.json) {
    for (const w of wsSpecs.warnings) {
      console.warn(`[lawmind-gate] 跳过无效规范 ${w.file}: ${w.message}`);
    }
  }

  if (args.packTaskId) {
    const draft = readDraft(args.workspaceDir, args.packTaskId);
    if (!draft) {
      console.error(`[lawmind-gate] --pack 找不到草稿: ${args.packTaskId}`);
      process.exit(2);
    }
    const md = await buildDraftAcceptancePackMarkdown(args.workspaceDir, draft);
    process.stdout.write(md);
    if (args.strict) {
      const r = validateDraftAgainstSpec(draft);
      if (!r.ready) {
        process.exit(1);
      }
    }
    return;
  }

  if (args.listSpecs) {
    if (args.json) {
      console.log(JSON.stringify(listDeliverableSpecs(), null, 2));
    } else {
      for (const s of listDeliverableSpecs()) {
        const blockerCount = s.requiredSections.filter((r) => r.severity === "blocker").length;
        console.log(
          `- ${s.type}\t${s.displayName}  (blockers=${blockerCount}, output=${s.defaultOutput})`,
        );
      }
    }
    return;
  }

  const items = pickDrafts(args.workspaceDir, args);
  if (items.length === 0) {
    if (!args.json) {
      console.log("[lawmind-gate] 没有匹配到草稿。可使用 --task <id> 或 --all。");
    } else {
      console.log("[]");
    }
    return;
  }

  const reports = items.map((it) => ({
    taskId: it.draft.taskId,
    report: validateDraftAgainstSpec(it.draft),
    draft: it.draft,
  }));

  if (args.json) {
    console.log(
      JSON.stringify(
        reports.map(({ taskId, report }) => ({ taskId, ...report })),
        null,
        2,
      ),
    );
  } else {
    for (const r of reports) {
      console.log(formatHuman(r.report, r.draft));
      console.log("");
    }
    const notReady = reports.filter((r) => !r.report.ready);
    console.log(`总计：${reports.length} 份草稿，未通过验收 ${notReady.length} 份。`);
  }

  if (args.strict && reports.some((r) => !r.report.ready)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[lawmind-gate] 失败：", err instanceof Error ? err.message : err);
  process.exit(2);
});
