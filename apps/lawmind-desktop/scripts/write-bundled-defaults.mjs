#!/usr/bin/env node
/**
 * 生成「随包下发的模型凭据」文件。
 *
 * 用法：
 *   node scripts/write-bundled-defaults.mjs --deepseek sk-xxxx
 *   LAWMIND_BUNDLED_DEEPSEEK_API_KEY=sk-xxxx node scripts/write-bundled-defaults.mjs
 *   node scripts/write-bundled-defaults.mjs --print      # 只报会写哪些键
 *   node scripts/write-bundled-defaults.mjs --remove     # 删掉本机这份（重新打包前用）
 *
 * 产物 `resources/defaults/provider-defaults.json` **不入库**（见 .gitignore）。
 * 把 key 写进 git 等于把它公开：任何拿到 dmg 的人都能解出包里的同一份文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const outFile = path.join(desktopRoot, "resources", "defaults", "provider-defaults.json");

/** DeepSeek 额外接受一个更短的名字，免得和运行时的 provider 变量混淆。 */
const DEEPSEEK_ALIAS_ENV = "LAWMIND_BUNDLED_DEEPSEEK_API_KEY";

const CLI_TO_ENV = {
  "--deepseek": "LAWMIND_PROVIDER_DEEPSEEK_API_KEY",
  "--dashscope": "LAWMIND_PROVIDER_DASHSCOPE_API_KEY",
  "--openai": "LAWMIND_PROVIDER_OPENAI_API_KEY",
  "--moonshot": "LAWMIND_PROVIDER_MOONSHOT_API_KEY",
  "--zhipu": "LAWMIND_PROVIDER_ZHIPU_API_KEY",
};

/** DeepSeek / 通义等都是 `sk-` 前缀；这里只挡明显不对的输入，不做格式考古。 */
const KEY_RE = /^[A-Za-z0-9._-]{12,}$/;

function parseArgs(argv) {
  const out = { keys: {}, print: false, remove: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--print") {
      out.print = true;
      continue;
    }
    if (arg === "--remove") {
      out.remove = true;
      continue;
    }
    const envName = CLI_TO_ENV[arg];
    if (envName) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} 需要一个 key 值`);
      }
      out.keys[envName] = value.trim();
      i += 1;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return out;
}

function collectKeys(cliKeys) {
  const keys = {};
  for (const [cliFlag, envName] of Object.entries(CLI_TO_ENV)) {
    const fromCli = cliKeys[envName];
    const fromEnv =
      (envName === "LAWMIND_PROVIDER_DEEPSEEK_API_KEY" ? process.env[DEEPSEEK_ALIAS_ENV] : "") ||
      process.env[envName];
    const value = String(fromCli ?? fromEnv ?? "").trim();
    if (!value) {
      continue;
    }
    if (!KEY_RE.test(value)) {
      throw new Error(`${cliFlag} 的值不像 API key（长度或字符集不对），已拒绝写入`);
    }
    keys[envName] = value;
  }
  return keys;
}

function readExistingNames() {
  try {
    const parsed = JSON.parse(fs.readFileSync(outFile, "utf8"));
    return Object.keys(parsed?.env && typeof parsed.env === "object" ? parsed.env : {});
  } catch {
    return [];
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.remove) {
    fs.rmSync(outFile, { force: true });
    console.log(`[lawmind-defaults] 已删除 ${path.relative(desktopRoot, outFile)}`);
    return;
  }

  const keys = collectKeys(args.keys);
  const names = Object.keys(keys);

  if (args.print) {
    const shipped = names.length > 0 ? names : readExistingNames();
    console.log(`[lawmind-defaults] 目标文件：${path.relative(desktopRoot, outFile)}`);
    console.log(
      shipped.length > 0
        ? `[lawmind-defaults] 打包将带上：${shipped.join(", ")}`
        : "[lawmind-defaults] 当前没有内置凭据；安装后需要律师自己配 key。",
    );
    return;
  }

  if (names.length === 0) {
    console.error(
      "[lawmind-defaults] 没有可写入的 key。用 --deepseek sk-... 或设置 LAWMIND_BUNDLED_DEEPSEEK_API_KEY。",
    );
    process.exitCode = 1;
    return;
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    env: keys,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(outFile, 0o600);

  console.log(`[lawmind-defaults] 已写入 ${path.relative(desktopRoot, outFile)}：${names.join(", ")}`);
  console.log("[lawmind-defaults] 该文件含明文密钥，已在 .gitignore 中排除，不要提交。");
}

try {
  main();
} catch (err) {
  console.error(`[lawmind-defaults] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
