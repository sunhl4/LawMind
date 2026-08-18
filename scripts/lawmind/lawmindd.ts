/**
 * 独立 lawmindd：启动与桌面相同的 127.0.0.1 HTTP，供 Word/WPS 侧车使用。
 * 不另开协议。默认端口 4312，与 sidecar/word/manifest.xml 一致。
 */

import { lawminddHelpText, parseLawminddArgs } from "../../src/lawmind/sidecar/cli.js";

function printHelp(): void {
  process.stdout.write(`${lawminddHelpText()}\n`);
}

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseLawminddArgs(process.argv.slice(2));
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (code === "invalid_port") {
      console.error("lawmindd: --port 必须是 1–65535");
    } else if (code.startsWith("unknown_flag:")) {
      console.error(`lawmindd: 未知参数 ${code.slice("unknown_flag:".length)}`);
    } else {
      console.error(`lawmindd: ${code}`);
    }
    printHelp();
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    return;
  }
  process.env.LAWMIND_WORKSPACE_DIR = opts.workspaceDir;
  process.env.LAWMIND_DESKTOP_PORT = String(opts.port);
  if (opts.envFile) {
    process.env.LAWMIND_ENV_FILE = opts.envFile;
  }
  await import("../../apps/lawmind-desktop/server/lawmind-local-server.ts");
}

void main();
