import fs from "node:fs";
import path from "node:path";

function normalizeWizardBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "")
    .toLowerCase();
}

const WIZARD_PROVIDER_BASES = {
  deepseek: "https://api.deepseek.com/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openai: "https://api.openai.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
};

/** Empty URL follows the product default (DeepSeek). */
export function inferWizardProviderId(baseUrl) {
  const n = normalizeWizardBaseUrl(baseUrl || WIZARD_PROVIDER_BASES.deepseek);
  for (const [id, defUrl] of Object.entries(WIZARD_PROVIDER_BASES)) {
    if (normalizeWizardBaseUrl(defUrl) === n) {
      return id;
    }
  }
  return null;
}

/** Map wizard model name → desktop default model id (mirrors src/lawmind/models/catalog). */
export function defaultModelIdForWizardModel(modelName) {
  const norm = String(modelName || "deepseek-flash")
    .trim()
    .toLowerCase();
  if (!norm) {
    return "env:current";
  }
  const builtins = [
    ["deepseek-flash", "builtin:deepseek-flash"],
    ["deepseek-v4-flash", "builtin:deepseek-flash"],
    ["deepseek-v4-flash-vision-exp", "builtin:deepseek-flash"],
    ["qwen-plus", "builtin:qwen-plus"],
    ["qwen-turbo", "builtin:qwen-turbo"],
    ["qwen-max", "builtin:qwen-max"],
    ["qwen3.5-plus", "builtin:qwen3.5-plus"],
    ["qwen-plus-latest", "builtin:qwen3.5-plus"],
    ["gpt-4o", "builtin:gpt-4o"],
    ["gpt-4o-mini", "builtin:gpt-4o-mini"],
    ["deepseek-chat", "builtin:deepseek-chat"],
    ["moonshot-v1-8k", "builtin:moonshot-v1-8k"],
    ["glm-4-plus", "builtin:glm-4-plus"],
  ];
  for (const [name, id] of builtins) {
    if (name === norm) {
      return id;
    }
  }
  return "env:current";
}

/**
 * Keep custom models + verification records when the wizard writes defaultModelId.
 * models.json is schema 2 after the first successful POST /api/models/test.
 */
export function mergeWizardDefaultIntoStore(raw, modelName) {
  const ok =
    raw &&
    (raw.schemaVersion === 1 || raw.schemaVersion === 2) &&
    Array.isArray(raw.customModels);
  const store = ok
    ? { ...raw, customModels: [...raw.customModels] }
    : { schemaVersion: 2, customModels: [], verifications: {} };
  store.schemaVersion = 2;
  store.verifications =
    store.verifications && typeof store.verifications === "object" && !Array.isArray(store.verifications)
      ? { ...store.verifications }
      : {};
  store.defaultModelId = defaultModelIdForWizardModel(modelName);
  return store;
}

export function writeWizardDefaultModelId(root, modelName) {
  const modelsPath = path.join(root, "models.json");
  let raw = null;
  try {
    if (fs.existsSync(modelsPath)) {
      raw = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    }
  } catch {
    raw = null;
  }
  const store = mergeWizardDefaultIntoStore(raw, modelName);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(modelsPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
