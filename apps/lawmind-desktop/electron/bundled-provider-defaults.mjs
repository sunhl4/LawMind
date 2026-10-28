/**
 * 随安装包分发的模型凭据（「开箱即用」）。
 *
 * ## 为什么运行时读文件，而不是写进代码
 *
 * 发给律师的安装包要开箱就能对话，所以 DeepSeek 的 key 必须随包走。但它**不能进 git**：
 * 仓库一旦推到远端，这把 key 就等于公开。安装包里的
 * `Resources/defaults/provider-defaults.json` 任何拿到 dmg 的人都能解出来 —— 这是
 * 「随包下发密钥」的固有代价，产品侧只能靠额度与轮换兜底，不能靠藏。真正要守住的是
 * 两件事：**不进版本库**，以及**永远不覆盖用户自己的配置**。
 *
 * ## 链路
 *
 * 1. `apps/lawmind-desktop/scripts/write-bundled-defaults.mjs` 生成
 *    `apps/lawmind-desktop/resources/defaults/provider-defaults.json`（`.gitignore` 排除）；
 * 2. electron-builder 的 `extraResources` 把它复制到 `Resources/defaults/`；
 * 3. 本模块在进程启动早期把缺的 key 补进 `process.env`，子进程（本机 API 服务、
 *    工作区 daemon）自然继承。
 *
 * ## 优先级（低 → 高）
 *
 * 本文件 < 系统环境变量 < 用户的 `.env.lawmind`（服务进程里 `dotenv` override）
 * < 钥匙串里设置页写入的 key。所以律师在设置页配了自己的 key 之后，内置 key 自动让位。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 允许随包下发的环境变量名（白名单）。
 *
 * 只收 provider 级别的 key：`LAWMIND_AGENT_API_KEY`（向导 profile）与
 * `LAWMIND_QWEN_API_KEY` 这类「会改变默认模型解析结果」的名字故意不在白名单里，
 * 内置凭据只做「某个 provider 可用」，不假装用户跑过向导。
 */
export const BUNDLED_DEFAULTS_ENV_KEYS = [
  "LAWMIND_PROVIDER_DEEPSEEK_API_KEY",
  "LAWMIND_PROVIDER_DASHSCOPE_API_KEY",
  "LAWMIND_PROVIDER_OPENAI_API_KEY",
  "LAWMIND_PROVIDER_MOONSHOT_API_KEY",
  "LAWMIND_PROVIDER_ZHIPU_API_KEY",
];

const ALLOWED = new Set(BUNDLED_DEFAULTS_ENV_KEYS);

/** 关掉内置凭据的逃生阀（排障 / 只验用户自己的 key）。 */
export const DISABLE_ENV = "LAWMIND_BUNDLED_DEFAULTS_DISABLED";
/** 覆盖文件位置（测试与「把包挂在别处」的场景）。 */
export const FILE_OVERRIDE_ENV = "LAWMIND_BUNDLED_DEFAULTS_FILE";

export function isBundledDefaultsDisabled(env = process.env) {
  const raw = (env?.[DISABLE_ENV] ?? "")
    .trim()
    .toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") {
    return true;
  }
  // E2E 必须与开发机上的随包 key 隔离：Playwright 把 mock provider 写在
  // `LAWMIND_AGENT_*` 里，而 `resolveDefaultModelId` 在「环境模型命中内置模型 +
  // 该 provider 有 key」时先返回内置模型 —— 内置 key 一旦生效，E2E 就会绕过 mock
  // 去打真实 API。测试不该因为开发者本机有打包凭据而改变连接目标。
  return (env?.LAWMIND_E2E ?? "").trim() === "1";
}

/**
 * 候选文件路径，按优先级排列：显式覆盖 → 打包资源目录 → 仓库内开发目录。
 * 返回数组而不是单个路径，这样打包态读不到时可以回落到开发目录（本地用 packaged 布局调试）。
 */
export function bundledDefaultsCandidates(opts = {}) {
  const env = opts.env ?? process.env;
  const override = String(opts.override ?? env[FILE_OVERRIDE_ENV] ?? "").trim();
  if (override) {
    return [path.resolve(override)];
  }
  const out = [];
  const resourcesPath =
    typeof opts.resourcesPath === "string"
      ? opts.resourcesPath
      : typeof process.resourcesPath === "string"
        ? process.resourcesPath
        : "";
  if (resourcesPath) {
    out.push(path.join(resourcesPath, "defaults", "provider-defaults.json"));
  }
  const electronDir = typeof opts.electronDir === "string" ? opts.electronDir : here;
  out.push(path.join(electronDir, "..", "resources", "defaults", "provider-defaults.json"));
  return out;
}

function sanitizeEnvMap(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (!ALLOWED.has(key)) {
      continue;
    }
    const v = typeof value === "string" ? value.trim() : "";
    if (!v) {
      continue;
    }
    env[key] = v;
  }
  return env;
}

/**
 * 读取随包凭据。读不到 / 格式不对 / 被关掉都返回 `null`，**绝不抛**：
 * 启动路径上任何异常都会变成「律师打不开软件」，比没有内置 key 严重得多。
 */
export function readBundledProviderDefaults(opts = {}) {
  if (isBundledDefaultsDisabled(opts.env ?? process.env)) {
    return null;
  }
  for (const file of bundledDefaultsCandidates(opts)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const env = sanitizeEnvMap(parsed?.env);
    if (Object.keys(env).length === 0) {
      continue;
    }
    return { file, env };
  }
  return null;
}

/**
 * 把随包凭据补进目标 env 的缺口。
 *
 * `applied` 只含真正生效的名字，`skipped` 含「用户已自己配过」的名字 —— 日志里只能
 * 打名字，绝不能打值。
 */
export function applyBundledProviderDefaults(opts = {}) {
  const target = opts.env ?? process.env;
  const read = readBundledProviderDefaults({ ...opts, env: target });
  if (!read) {
    return { file: "", applied: [], skipped: [] };
  }
  const applied = [];
  const skipped = [];
  for (const [key, value] of Object.entries(read.env)) {
    const existing = String(target[key] ?? "").trim();
    if (existing) {
      skipped.push(key);
      continue;
    }
    target[key] = value;
    applied.push(key);
  }
  return { file: read.file, applied, skipped };
}

/** 一行不含密钥的启动日志。 */
export function describeBundledProviderDefaults(result) {
  if (!result || result.applied.length === 0) {
    return "";
  }
  return `[LawMind] 已启用随包下发的模型凭据：${result.applied.join(", ")}（${result.file}）`;
}
