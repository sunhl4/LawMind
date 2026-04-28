import { loadLawMindEnv } from "./lawmind-env-loader.js";
type CheckStatus = "ready" | "partial" | "off";

type ProviderCheck = {
  name: string;
  kind: "general" | "legal" | "framework" | "partner";
  required: string[];
  optional?: string[];
};

const PROVIDERS: ProviderCheck[] = [
  // Domestic general providers
  {
    name: "Qwen (DashScope)",
    kind: "general",
    required: ["LAWMIND_QWEN_API_KEY", "LAWMIND_QWEN_MODEL"],
  },
  {
    name: "DeepSeek",
    kind: "general",
    required: ["LAWMIND_DEEPSEEK_API_KEY", "LAWMIND_DEEPSEEK_MODEL"],
  },
  {
    name: "GLM (Zhipu)",
    kind: "general",
    required: ["LAWMIND_GLM_API_KEY", "LAWMIND_GLM_MODEL"],
  },
  {
    name: "Moonshot (Kimi)",
    kind: "general",
    required: ["LAWMIND_MOONSHOT_API_KEY", "LAWMIND_MOONSHOT_MODEL"],
  },
  {
    name: "SiliconFlow",
    kind: "general",
    required: ["LAWMIND_SILICONFLOW_API_KEY", "LAWMIND_SILICONFLOW_MODEL"],
  },
  // Open-source legal models
  {
    name: "ChatLaw",
    kind: "legal",
    required: ["LAWMIND_CHATLAW_BASE_URL", "LAWMIND_CHATLAW_MODEL"],
    optional: ["LAWMIND_CHATLAW_API_KEY"],
  },
  {
    name: "LaWGPT",
    kind: "legal",
    required: ["LAWMIND_LAWGPT_BASE_URL", "LAWMIND_LAWGPT_MODEL"],
    optional: ["LAWMIND_LAWGPT_API_KEY"],
  },
  // Framework integration
  {
    name: "LexEdge",
    kind: "framework",
    required: ["LAWMIND_LEXEDGE_ENDPOINT"],
    optional: ["LAWMIND_LEXEDGE_TOKEN"],
  },
  // Partner extension slot
  {
    name: "Partner Legal Model",
    kind: "partner",
    required: ["LAWMIND_PARTNER_LEGAL_BASE_URL", "LAWMIND_PARTNER_LEGAL_MODEL"],
    optional: ["LAWMIND_PARTNER_LEGAL_API_KEY"],
  },
];

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function calcStatus(required: string[]): CheckStatus {
  const present = required.filter(hasEnv).length;
  if (present === 0) {
    return "off";
  }
  if (present === required.length) {
    return "ready";
  }
  return "partial";
}

function statusIcon(status: CheckStatus): string {
  if (status === "ready") {
    return "✅";
  }
  if (status === "partial") {
    return "⚠️";
  }
  return "○";
}

function statusLabel(status: CheckStatus): string {
  if (status === "ready") {
    return "ready";
  }
  if (status === "partial") {
    return "partial";
  }
  return "off";
}

function printProviderCheck(provider: ProviderCheck): CheckStatus {
  const status = calcStatus(provider.required);
  const missing = provider.required.filter((k) => !hasEnv(k));
  const presentRequired = provider.required.filter(hasEnv);

  console.log(`${statusIcon(status)} ${provider.name} [${provider.kind}] - ${statusLabel(status)}`);
  console.log(`   required: ${provider.required.join(", ")}`);
  console.log(`   present: ${presentRequired.length > 0 ? presentRequired.join(", ") : "(none)"}`);
  if (missing.length > 0) {
    console.log(`   missing: ${missing.join(", ")}`);
  }
  if (provider.optional && provider.optional.length > 0) {
    const presentOptional = provider.optional.filter(hasEnv);
    console.log(
      `   optional: ${provider.optional.join(", ")}${presentOptional.length > 0 ? ` (present: ${presentOptional.join(", ")})` : ""}`,
    );
  }
  return status;
}

function parseStrict(argv: string[]): boolean {
  return argv.some((a) => a === "--strict" || a === "-s");
}

function main() {
  const strict = parseStrict(process.argv.slice(2));
  const loaded = loadLawMindEnv();

  console.log("LawMind Environment Check");
  console.log("=========================");
  console.log(`env-file: ${loaded.path} (${loaded.loaded ? "loaded" : "not found"})`);
  if (strict) {
    console.log("mode: strict (CI/delivery)");
  }
  console.log("");

  const results = PROVIDERS.map((p) => ({ provider: p, status: printProviderCheck(p) }));

  const readyCount = results.filter((r) => r.status === "ready").length;
  const partialCount = results.filter((r) => r.status === "partial").length;
  const offCount = results.filter((r) => r.status === "off").length;

  const hasReadyGeneral = results.some(
    (r) => r.provider.kind === "general" && r.status === "ready",
  );
  const hasReadyLegal = results.some(
    (r) => (r.provider.kind === "legal" || r.provider.kind === "partner") && r.status === "ready",
  );
  const hasAnyReady = results.some((r) => r.status === "ready");

  console.log("");
  console.log("Summary");
  console.log("-------");
  console.log(`ready=${readyCount}, partial=${partialCount}, off=${offCount}`);
  console.log(
    `pipeline-readiness: ${hasReadyGeneral && hasReadyLegal ? "ready (general+legal)" : hasAnyReady ? "partial (some providers ready)" : "mock-only"}`,
  );

  console.log("");
  console.log("Suggested minimal setups");
  console.log("------------------------");
  console.log("- 快速起步（无本地法律模型）: qwen-only 预设");
  console.log(
    "  需要: LAWMIND_QWEN_API_KEY, LAWMIND_QWEN_MODEL, LAWMIND_CHATLAW_API_KEY(=同 Qwen), LAWMIND_CHATLAW_BASE_URL, LAWMIND_CHATLAW_MODEL",
  );
  console.log("- 本地 ChatLaw: qwen-chatlaw 预设");
  console.log(
    "  需要: LAWMIND_QWEN_API_KEY, LAWMIND_QWEN_MODEL, LAWMIND_CHATLAW_BASE_URL, LAWMIND_CHATLAW_MODEL",
  );
  console.log("- 备用组合: DeepSeek + LaWGPT");
  console.log(
    "  需要: LAWMIND_DEEPSEEK_API_KEY, LAWMIND_DEEPSEEK_MODEL, LAWMIND_LAWGPT_BASE_URL, LAWMIND_LAWGPT_MODEL",
  );
  console.log("- 框架路径: 任一通用模型 + LexEdge");
  console.log("  需要: (任一通用模型变量) + LAWMIND_LEXEDGE_ENDPOINT");
  console.log("- 合作部署: 任一通用模型 + Partner Legal Model");
  console.log(
    "  需要: (任一通用模型变量) + LAWMIND_PARTNER_LEGAL_BASE_URL, LAWMIND_PARTNER_LEGAL_MODEL",
  );

  if (!hasAnyReady) {
    console.log("");
    console.log("Tip: copy and fill template:");
    console.log("  cp .env.lawmind.example .env.lawmind");
    console.log("  # then run:");
    console.log("  npm run lawmind:env:check");
  }

  if (strict && !(hasReadyGeneral && hasReadyLegal)) {
    console.log("");
    console.log("[LawMind] --strict: pipeline not ready (general+legal required).");
    process.exitCode = 1;
  }
}

main();
