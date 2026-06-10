import path from "node:path";
import {
  createLawMindEngine,
  flushQualityDashboard,
  seedQualityAfterTask,
} from "../../src/lawmind/index.js";
import { reviewDraftInCli } from "../../src/lawmind/review/cli.js";
import { buildLawMindCliAdapters } from "./lawmind-engine-adapters.js";
import { loadLawMindEnv } from "./lawmind-env-loader.js";

function parseFailOnEmptyClaims(argv: string[]): boolean {
  return argv.some((a) => a === "--fail-on-empty-claims" || a === "--fail-empty-claims");
}

async function main() {
  const failOnEmptyClaims = parseFailOnEmptyClaims(process.argv.slice(2));
  const loaded = loadLawMindEnv();
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  const interactiveReview =
    (process.env.LAWMIND_INTERACTIVE_REVIEW ?? "").trim().toLowerCase() === "1";

  const { adapters, useRealModel } = buildLawMindCliAdapters(workspaceDir);
  const engine = createLawMindEngine({ workspaceDir, adapters });

  const intent = engine.plan("请整理合同审查意见并生成律师函草稿", {
    audience: "客户",
    templateId: "word/demand-letter-default",
  });
  await engine.confirm(intent.taskId, {
    actorId: "lawyer:smoke",
    note: "smoke task confirmed",
  });

  const bundle = await engine.research(intent);

  if (useRealModel && failOnEmptyClaims && bundle.claims.length === 0) {
    console.error("[LawMind] Diagnostic (real model, 0 claims):");
    console.error(`  env-file=${loaded.path} (${loaded.loaded ? "loaded" : "not found"})`);
    const chatlawUrl = process.env.LAWMIND_CHATLAW_BASE_URL ?? "(not set)";
    const chatlawHint =
      String(chatlawUrl).startsWith("http://127.0.0.1") ||
      String(chatlawUrl).startsWith("http://localhost")
        ? " (local; ensure ChatLaw is running or use qwen-only: set LAWMIND_CHATLAW_BASE_URL to https://dashscope.aliyuncs.com/compatible-mode/v1)"
        : "";
    console.error(`  LAWMIND_CHATLAW_BASE_URL=${chatlawUrl}${chatlawHint}`);
    console.error(
      `  sources=${bundle.sources.length}, riskFlags=${bundle.riskFlags.length}, missingItems=${bundle.missingItems.length}`,
    );
    if (bundle.riskFlags.length > 0) {
      console.error("  riskFlags:", bundle.riskFlags.slice(0, 5).join(" | "));
    }
    if (bundle.missingItems.length > 0) {
      console.error("  missingItems:", bundle.missingItems.slice(0, 5).join(" | "));
    }
    throw new Error(
      "[LawMind] --fail-on-empty-claims: real model returned no claims. " +
        "Run from the directory that contains your .env.lawmind (e.g. cd ~/.lawmind/checkout). " +
        "Check .env.lawmind (npm run lawmind:env:check), model connectivity, and that the model returns JSON with a non-empty 'claims' array. " +
        "Run without --fail-on-empty-claims to complete the pipeline and inspect riskFlags.",
    );
  }

  const draft = engine.draft(intent, bundle, { title: "LawMind Smoke 律师函草稿" });

  if (interactiveReview) {
    const reviewed = await reviewDraftInCli(draft, { workspaceDir });
    if (!reviewed.ok) {
      throw new Error(`草稿未通过审核: ${reviewed.reason}`);
    }
    const reviewStatus = reviewed.draft.reviewStatus;
    await engine.review(reviewed.draft, {
      actorId: reviewed.draft.reviewedBy,
      status: reviewStatus === "pending" ? "approved" : reviewStatus,
    });
  } else {
    // smoke 流程默认自动通过
    await engine.review(draft, {
      actorId: "lawyer:smoke",
      status: "approved",
      note: "smoke auto approval",
    });
  }

  const rendered = await engine.render(draft);
  if (!rendered.ok) {
    throw new Error(rendered.error ?? "LawMind smoke failed.");
  }

  await seedQualityAfterTask(engine, workspaceDir, intent.taskId, ["质量范例"]);
  await flushQualityDashboard(workspaceDir);

  console.log("[LawMind] Smoke success.");
  console.log(`env-file=${loaded.path} (${loaded.loaded ? "loaded" : "not found"})`);
  console.log(`mode=${useRealModel ? "real-model" : "mock-model"}`);
  console.log(`review=${interactiveReview ? "interactive" : "auto-smoke"}`);
  console.log(`intent: ${intent.kind}, risk=${intent.riskLevel}`);
  console.log(`sources=${bundle.sources.length}, claims=${bundle.claims.length}`);
  console.log(`output=${rendered.outputPath}`);
  if (failOnEmptyClaims) {
    console.log("fail-on-empty-claims: passed (claims > 0 or mock mode)");
  }
}

main().catch((err) => {
  console.error("[LawMind] Smoke failed:", err);
  process.exitCode = 1;
});
