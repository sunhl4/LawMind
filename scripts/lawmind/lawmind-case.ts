import path from "node:path";
import {
  buildMatterIndex,
  listMatterOverviews,
  searchMatterIndex,
  summarizeMatterIndex,
} from "../../src/lawmind/index.js";

function parseMatterId(argv: string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === "--matter");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function parseSearch(argv: string[]): string | undefined {
  const idx = argv.findIndex((arg) => arg === "--search");
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  const argv = process.argv.slice(2);
  const matterId = parseMatterId(argv);
  const search = parseSearch(argv);

  if (!matterId) {
    const overviews = await listMatterOverviews(workspaceDir);
    if (overviews.length === 0) {
      console.log("[LawMind] No matters found.");
      return;
    }

    console.log("LawMind matters:");
    for (const item of overviews) {
      console.log(
        `- ${item.matterId} | open=${item.openTaskCount} rendered=${item.renderedTaskCount} risks=${item.riskCount} updated=${item.latestUpdatedAt ?? "n/a"}`,
      );
      if (item.topIssue) {
        console.log(`  issue: ${item.topIssue}`);
      }
    }
    console.log("\nUse: npm run lawmind:case -- --matter <matterId> [--search <query>]");
    return;
  }

  const index = await buildMatterIndex(workspaceDir, matterId);
  const summary = summarizeMatterIndex(index);
  console.log(`LawMind Matter Summary: ${index.matterId}`);
  console.log(`caseFile: ${index.caseFilePath}`);
  console.log(`latestUpdatedAt: ${index.latestUpdatedAt ?? "n/a"}`);
  console.log(
    `tasks=${index.tasks.length}, open=${index.openTasks.length}, rendered=${index.renderedTasks.length}, drafts=${index.drafts.length}, auditEvents=${index.auditEvents.length}`,
  );
  console.log(`headline: ${summary.headline}`);
  console.log(`status: ${summary.statusLine}`);

  const printSection = (title: string, items: string[]) => {
    console.log(`\n## ${title}`);
    if (items.length === 0) {
      console.log("- (none)");
      return;
    }
    for (const item of items.slice(0, 10)) {
      console.log(`- ${item}`);
    }
  };

  printSection("Next Actions", summary.nextActions);
  printSection("Recent Activity", summary.recentActivity);
  printSection("Core Issues", index.coreIssues);
  printSection("Task Goals", index.taskGoals);
  printSection("Risk Notes", index.riskNotes);
  printSection("Artifacts", index.artifacts);

  if (search) {
    const hits = searchMatterIndex(index, search);
    console.log(`\n## Search: ${search}`);
    if (hits.length === 0) {
      console.log("- (no matches)");
    } else {
      for (const hit of hits.slice(0, 20)) {
        console.log(`- [${hit.section}] ${hit.text}${hit.taskId ? ` (task: ${hit.taskId})` : ""}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[LawMind] Matter summary failed:", err);
  process.exitCode = 1;
});
