import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import {
  createLawMindEngine,
  createWorkspaceAdapter,
  readDraft,
  readTaskRecord,
} from "../../src/lawmind/index.js";
import { listTaskRecords } from "../../src/lawmind/tasks/index.js";

function parseTaskId(argv: string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === "--task");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function formatPreview(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  const engine = createLawMindEngine({
    workspaceDir,
    adapters: [createWorkspaceAdapter(workspaceDir)],
  });

  const requestedTaskId = parseTaskId(process.argv.slice(2));
  const tasks = listTaskRecords(workspaceDir);

  if (tasks.length === 0) {
    console.log("[LawMind] No persisted tasks found in workspace/tasks.");
    return;
  }

  let task =
    (requestedTaskId ? readTaskRecord(workspaceDir, requestedTaskId) : undefined) ??
    tasks.find((item) => item.status === "drafted" || item.status === "reviewed") ??
    tasks[0];

  if (!task) {
    console.log("[LawMind] No task available.");
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log("\n=== LawMind 任务审核台（最小版） ===");
    console.log(`taskId: ${task.taskId}`);
    console.log(`status: ${task.status}`);
    console.log(`kind: ${task.kind}`);
    console.log(`risk: ${task.riskLevel}`);
    console.log(`summary: ${task.summary}`);
    if (task.matterId) {
      console.log(`matterId: ${task.matterId}`);
    }
    if (task.title) {
      console.log(`title: ${task.title}`);
    }
    if (task.draftPath) {
      console.log(`draftPath: ${task.draftPath}`);
    }

    if (task.requiresConfirmation && task.status === "created") {
      const confirmTask = (await rl.question("\n任务需要先确认，是否确认后继续？(y/n): "))
        .trim()
        .toLowerCase();
      if (confirmTask === "y" || confirmTask === "yes") {
        const actorId = (await rl.question("确认人标识(默认 lawyer:cli): ")).trim() || "lawyer:cli";
        const note = (await rl.question("确认备注(可空): ")).trim();
        task = await engine.confirm(task.taskId, { actorId, note: note || undefined });
        console.log(`[LawMind] Task confirmed: ${task.taskId}`);
      } else {
        console.log("[LawMind] Confirmation skipped.");
        return;
      }
    }

    const draft = engine.getDraft(task.taskId) ?? readDraft(workspaceDir, task.taskId);
    if (!draft) {
      console.log("\n[LawMind] 当前任务尚无持久化草稿。");
      console.log("提示：先执行 research + draft，再回到审核台。");
      return;
    }

    console.log("\n--- 草稿信息 ---");
    console.log(`title: ${draft.title}`);
    console.log(`template: ${draft.templateId}`);
    console.log(`reviewStatus: ${draft.reviewStatus}`);
    console.log(`summary: ${draft.summary}`);
    console.log("\n--- 章节预览 ---");
    for (const [index, section] of draft.sections.entries()) {
      console.log(`\n[${index + 1}] ${section.heading}`);
      console.log(formatPreview(section.body, 220));
    }

    const action = (await rl.question("\n动作 approve / reject / modified / render / skip ? "))
      .trim()
      .toLowerCase();

    if (!["approve", "reject", "modified", "render"].includes(action)) {
      console.log("[LawMind] No changes applied.");
      return;
    }

    if (action === "render") {
      const result = await engine.render(draft);
      if (!result.ok) {
        throw new Error(result.error ?? "render failed");
      }
      console.log(`[LawMind] Rendered: ${result.outputPath}`);
      return;
    }

    const actorId = (await rl.question("审核人标识(默认 lawyer:cli): ")).trim() || "lawyer:cli";
    const note = (await rl.question("审核备注(可空): ")).trim();
    const status =
      action === "approve" ? "approved" : action === "reject" ? "rejected" : "modified";
    const reviewed = await engine.review(draft, {
      actorId,
      status,
      note: note || undefined,
    });

    console.log(`[LawMind] Draft reviewed: ${reviewed.reviewStatus}`);

    if (reviewed.reviewStatus === "approved") {
      const renderNow = (await rl.question("是否立即渲染为文书？(y/n): ")).trim().toLowerCase();
      if (renderNow === "y" || renderNow === "yes") {
        const result = await engine.render(reviewed);
        if (!result.ok) {
          throw new Error(result.error ?? "render failed");
        }
        console.log(`[LawMind] Rendered: ${result.outputPath}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("[LawMind] Review failed:", err);
  process.exitCode = 1;
});
