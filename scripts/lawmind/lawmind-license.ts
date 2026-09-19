/**
 * 离线许可签发 CLI（发行方内部用）。
 *
 *   pnpm lawmind:license -- --licensee "张三律师" --edition solo --days 365
 *   pnpm lawmind:license -- --licensee "某某律所" --edition firm --months 12 --bind-machine
 *
 * 输出一行激活码，交给律师在「设置 → 许可」里粘贴。
 *
 * ⚠️ 开发密钥对：下面的私钥仅用于内测签发与自动化测试。
 * 对外发版前必须：
 *   1. 生成生产密钥对；
 *   2. 把生产公钥写入 `src/lawmind/license/keys.ts`；
 *   3. 把生产私钥放在发行方密钥库（不要留在仓库），并删除此处的 DEV 私钥；
 *   4. 重新签发已发出的激活码。
 *
 * 私钥**只**存在于本脚本（不进 `src/` 引擎包）。本 CLI 不联网、不写遥测。
 */

import { pathToFileURL } from "node:url";
import {
  machineFingerprint,
  signActivationCode,
  type LicenseEdition,
} from "../../src/lawmind/license/index.js";

/** 与 `src/lawmind/license/keys.ts` 里 DEV 公钥配对（pkcs8 DER base64）。 */
export const DEV_LICENSE_PRIVATE_KEY_DER_B64 =
  "MC4CAQAwBQYDK2VwBCIEIJjmf5CX/pnEWwasqBGyrSVxbrXssMRroCHhgjd8JAaI";

export type IssueLicenseArgs = {
  licensee: string;
  edition: LicenseEdition;
  days?: number;
  months?: number;
  bindMachine: boolean;
  fingerprint?: string;
};

export function parseIssueArgs(argv: string[]): IssueLicenseArgs {
  let licensee = "";
  let edition: LicenseEdition = "solo";
  let days: number | undefined;
  let months: number | undefined;
  let bindMachine = false;
  let fingerprint: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--licensee" && next) {
      licensee = next.trim();
      i += 1;
    } else if (arg === "--edition" && next) {
      if (next === "solo" || next === "firm" || next === "private_deploy") {
        edition = next;
      }
      i += 1;
    } else if (arg === "--days" && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) {
        days = n;
      }
      i += 1;
    } else if (arg === "--months" && next) {
      const n = Number.parseInt(next, 10);
      if (Number.isFinite(n) && n > 0) {
        months = n;
      }
      i += 1;
    } else if (arg === "--bind-machine") {
      bindMachine = true;
    } else if (arg === "--fingerprint" && next) {
      fingerprint = next.trim();
      i += 1;
    }
  }
  return { licensee, edition, days, months, bindMachine, fingerprint };
}

/** 由参数产出一行激活码（纯函数，便于测试与批量签发）。 */
export function issueLicenseCode(
  args: IssueLicenseArgs,
  opts?: { now?: Date; privateKeyDerB64?: string },
): { code: string; expiresAt?: string } {
  const issuedAt = opts?.now ?? new Date();
  let expiresAt: string | undefined;
  if (args.days || args.months) {
    const expiry = new Date(issuedAt);
    if (args.days) {
      expiry.setDate(expiry.getDate() + args.days);
    }
    if (args.months) {
      expiry.setMonth(expiry.getMonth() + args.months);
    }
    expiresAt = expiry.toISOString();
  }
  const code = signActivationCode(
    {
      v: 1,
      edition: args.edition,
      licensee: args.licensee,
      issuedAt: issuedAt.toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
      ...(args.bindMachine ? { machineFingerprint: args.fingerprint ?? machineFingerprint() } : {}),
    },
    opts?.privateKeyDerB64 ?? DEV_LICENSE_PRIVATE_KEY_DER_B64,
  );
  return { code, ...(expiresAt ? { expiresAt } : {}) };
}

function runCli(argv: string[]): void {
  const args = parseIssueArgs(argv);
  if (!args.licensee) {
    console.error(
      '用法：pnpm lawmind:license -- --licensee "张三律师" [--edition solo|firm|private_deploy] [--days 365 | --months 12] [--bind-machine]',
    );
    process.exit(1);
  }
  const { code, expiresAt } = issueLicenseCode(args);
  console.log(code);
  console.error(
    `已签发：${args.licensee}（${args.edition}）${
      expiresAt ? ` 有效期至 ${expiresAt.slice(0, 10)}` : " 长期"
    }${args.bindMachine ? " · 绑定本机" : ""}`,
  );
}

// 仅在作为 CLI 直接运行时执行；被 import 时无副作用（测试要 import 开发私钥）。
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli(process.argv.slice(2));
}
