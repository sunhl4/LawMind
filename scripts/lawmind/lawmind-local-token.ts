#!/usr/bin/env node
/**
 * 本机 API 的 CLI 客户端凭据读取器（`pnpm lawmind:local:token`）。
 *
 * ## 为什么需要它
 *
 * 本地 API 现在按客户端身份发凭据（见
 * `apps/lawmind-desktop/electron/local-api-credentials.mjs`）。桌面主进程与渲染层走
 * IPC、Word 插件走同源 `config.js`，而脚本 / curl / CI **没有投递通道**：它们只能
 * 从桌面端写出的 0600 发现文件里取。
 *
 * 为什么不让 CLI 直接读安装密钥：安装密钥泄了等于**根密钥**泄了 —— 拿到它就能为
 * 任意 clientId 现算出合法凭据；而 `cli` 凭据泄了只能读（scope 是只读的）。
 *
 * ## 凭据的权限边界（cli）
 *
 * 只读：GET/HEAD/OPTIONS 放行，写操作由服务端 403。要改案卷请走桌面端 ——
 * 这不是限制脚本作者，而是让「谁在什么时候改了什么」在审计里始终说得清。
 *
 * ## 用法
 *
 *   pnpm lawmind:local:token               # 只打印凭据（给 curl 用）
 *   pnpm lawmind:local:token --json        # 打印 base / epoch / instanceId / token
 *   pnpm lawmind:local:token --status      # 探一次本机服务并打印发现端点载荷
 *   pnpm lawmind:local:token --client cli  # 已固定的客户端身份（目前只支持 cli）
 *
 * 示例：
 *
 *   BASE=$(pnpm -s lawmind:local:token --json | node -e "…base…")
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 发现文件的位置：`<userData>/LawMind/local-api-clients.json`。
 *
 * 开发态 `userData` 是 `<appData>/Electron`（见 `pinDevUserData`），打包态是应用自身
 * 的 userData。两者都可能出现，所以两个都探；`LAWMIND_USER_DATA_DIR` 与
 * `LAWMIND_LOCAL_API_CLIENTS_FILE` 可用于测试与非常规安装。
 */
/** 从桌面端写出的发现文件里读到的记录（形状与 `.well-known/lawmind-local` 一致，另带 credentials）。 */
type LocalApiClientRecord = {
  base: string;
  epoch?: number;
  instanceId?: string;
  credentials?: Record<string, string>;
};

type DiscoveryRead = {
  record: LocalApiClientRecord | null;
  file: string | null;
  tried: string[];
};

/** 候选发现文件（去重后返回）。 */
function candidateFiles(): string[] {
  const explicit = process.env.LAWMIND_LOCAL_API_CLIENTS_FILE?.trim();
  const out: string[] = [];
  if (explicit) {
    out.push(explicit);
  }
  const override = process.env.LAWMIND_USER_DATA_DIR?.trim();
  const appData =
    process.env.LAWMIND_APP_DATA_DIR?.trim() ||
    path.join(os.homedir(), "Library", "Application Support");
  if (override) {
    out.push(path.join(path.resolve(override), "LawMind", "local-api-clients.json"));
  }
  // 打包版（LawMind 自己的 userData）与开发态（Electron 的 userData）都放进来。
  out.push(path.join(appData, "LawMind", "local-api-clients.json"));
  out.push(path.join(appData, "Electron", "LawMind", "local-api-clients.json"));
  return [...new Set(out)];
}

function readDiscoveryFile(): DiscoveryRead {
  const tried: string[] = [];
  for (const file of candidateFiles()) {
    tried.push(file);
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as LocalApiClientRecord;
      if (parsed && typeof parsed.base === "string") {
        return { record: parsed, file, tried };
      }
    } catch {
      /* 试下一个 */
    }
  }
  return { record: null, file: null, tried };
}

function fail(message: string, hint?: string): never {
  console.error(`[lawmind:local:token] ${message}`);
  if (hint) {
    console.error(hint);
  }
  process.exit(1);
}

type CliArgs = { json: boolean; status: boolean; client: string; help: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, status: false, client: "cli", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
    } else if (token === "--status") {
      args.status = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--client") {
      const next = argv[i + 1];
      if (!next) {
        fail("--client 需要一个值");
      }
      args.client = next.trim();
      i += 1;
    }
  }
  return args;
}

const HELP = `本机 API 的 CLI 凭据

  pnpm lawmind:local:token            打印凭据
  pnpm lawmind:local:token --json     打印 base / epoch / instanceId / token
  pnpm lawmind:local:token --status   探一次本机服务（发现端点）

说明：cli 身份只读（GET/HEAD/OPTIONS）。写操作请走桌面端。
凭据来自桌面端写出的发现文件；应用没在运行时该文件会被删除，也就没有凭据可取。
`;

type ProbeResult = { ok: true; payload: unknown } | { ok: false; status?: number; error: string };

async function probe(base: string, token: string | undefined): Promise<ProbeResult> {
  try {
    const res = await fetch(`${base}/.well-known/lawmind-local`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, payload: await res.json() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const { record, file, tried } = readDiscoveryFile();
  if (!record) {
    fail(
      "没找到本机 API 的发现文件（说明 LawMind 桌面端没在运行）。",
      [
        "先启动桌面端：pnpm lawmind:desktop",
        "找过这些位置：",
        ...(tried ?? []).map((p) => `  - ${p}`),
      ].join("\n"),
    );
  }

  const token = record.credentials?.[args.client];
  if (args.status) {
    const result = await probe(record.base, token);
    console.log(
      JSON.stringify({ base: record.base, file, client: args.client, probe: result }, null, 2),
    );
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }

  if (!token) {
    fail(
      `发现文件里没有 ${args.client} 的凭据。`,
      `可用客户端：${Object.keys(record.credentials ?? {}).join(", ") || "（无）"}`,
    );
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          base: record.base,
          epoch: record.epoch,
          instanceId: record.instanceId,
          client: args.client,
          token,
        },
        null,
        2,
      ),
    );
    return;
  }

  // 默认只吐凭据本身：方便 `TOKEN=$(pnpm -s lawmind:local:token)` 直接接进脚本。
  console.log(token);
}

void main();
