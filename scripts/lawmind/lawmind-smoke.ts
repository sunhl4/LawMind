import path from "node:path";
import {
  createLawMindEngine,
  createGeneralModelAdapter,
  createLegalModelAdapter,
  createOpenSourceLegalAdaptersFromEnv,
  createLexEdgeAdapterFromEnv,
  createDomesticGeneralAdaptersFromEnv,
  createPartnerLegalAdapterFromEnv,
  createWorkspaceAdapter,
} from "../../src/lawmind/index.js";
import { reviewDraftInCli } from "../../src/lawmind/review/cli.js";
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

  const mockGeneralAdapter = createGeneralModelAdapter(async () => ({
    claims: [
      {
        text: "该事项需要先完成事实清单与证据清单，再形成正式法律意见。",
        confidence: 0.82,
      },
    ],
    sources: [{ title: "内部工作流规范", citation: "workspace/MEMORY.md" }],
  }));

  const mockLegalAdapter = createLegalModelAdapter(async () => ({
    claims: [
      {
        text: "在作出最终法律意见前，应明确适用法律条款并核对最新修订版本。",
        confidence: 0.9,
      },
    ],
    sources: [{ title: "法律检索规则", citation: "通用法律工作流规则" }],
    riskFlags: ["当前为 smoke 数据，需替换为真实检索来源。"],
  }));

  const realAdapters = [
    ...createDomesticGeneralAdaptersFromEnv(),
    ...createOpenSourceLegalAdaptersFromEnv(),
    ...createLexEdgeAdapterFromEnv(),
    ...createPartnerLegalAdapterFromEnv(),
  ];
  const useRealModel = realAdapters.length > 0;
  const modelAdapters = useRealModel ? realAdapters : [mockGeneralAdapter, mockLegalAdapter];

  const engine = createLawMindEngine({
    workspaceDir,
    adapters: [createWorkspaceAdapter(workspaceDir), ...modelAdapters],
  });

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
    await engine.review(reviewed.draft, {
      actorId: reviewed.draft.reviewedBy,
      status: reviewed.draft.reviewStatus,
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
