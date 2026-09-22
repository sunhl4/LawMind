/**
 * 托管案件云服务端 —— 可直接运行的入口。
 *
 * ## 为什么需要它
 *
 * 今天跨机器共案要求律所提供一个共享位置（`sharedRelayDir`），而最初需求明确要避免这一点。
 * 这个进程就是那台「厂商自己当的主机」：桌面端把 `matterReplica.endpoint` 指过来即可，
 * 律所不需要 NAS、VPN 或共享盘。
 *
 * ## 运行
 *
 *   pnpm lawmind:matter-cloud            # 监听 127.0.0.1:8788（默认，本地自测）
 *   pnpm lawmind:matter-cloud -- --setup  # 首次：建租户 + 打印一次管理员令牌
 *
 * 环境变量：
 * - `LAWMIND_MATTER_CLOUD_DIR`   数据目录（默认 `./.lawmind-matter-cloud`）
 * - `LAWMIND_MATTER_CLOUD_PORT`  端口（默认 8788）
 * - `LAWMIND_MATTER_CLOUD_HOST`  绑定地址（默认 127.0.0.1；对外服务请置 0.0.0.0 并**自行加 TLS**）
 * - `LAWMIND_MATTER_CLOUD_TENANT` / `_ADMIN_NAME`  `--setup` 时用
 *
 * ## 安全提醒（务必读）
 *
 * 本进程只做**应用层**鉴权（令牌 + 成员授权 + 哈希校验）。生产部署必须由外层负责：
 * TLS 终止、限流、审计日志留存、备份、密钥托管。**不要**把明文 HTTP 直接暴露到公网。
 */

import path from "node:path";
import { createMatterCloudServer } from "../../src/lawmind/matter-cloud/index.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const dataDir = path.resolve(
  arg("--dir") ?? process.env.LAWMIND_MATTER_CLOUD_DIR ?? ".lawmind-matter-cloud",
);
const port = Number(arg("--port") ?? process.env.LAWMIND_MATTER_CLOUD_PORT ?? 8788);
const host = arg("--host") ?? process.env.LAWMIND_MATTER_CLOUD_HOST ?? "127.0.0.1";

const cloud = createMatterCloudServer({
  dataDir,
  logger: (msg) => console.error(`[matter-cloud] ${msg}`),
});

if (process.argv.includes("--setup")) {
  const tenantName = process.env.LAWMIND_MATTER_CLOUD_TENANT ?? "示范律所";
  const adminName = process.env.LAWMIND_MATTER_CLOUD_ADMIN_NAME ?? "管理员";
  const adminLawyerId = process.env.LAWMIND_MATTER_CLOUD_ADMIN_LAWYER_ID ?? "lawyer_admin";

  const existing = cloud.directory.listTenants().find((t) => t.name === tenantName);
  const tenant = existing ?? cloud.directory.createTenant({ name: tenantName });
  const { account, token } = cloud.directory.createAccount({
    tenantId: tenant.tenantId,
    lawyerId: adminLawyerId,
    displayName: adminName,
    role: "admin",
  });

  console.log("");
  console.log("已创建租户与管理员账号。**令牌只显示这一次**，请立刻保存：");
  console.log("");
  console.log(`  数据目录     ${dataDir}`);
  console.log(`  tenantId     ${tenant.tenantId}`);
  console.log(`  accountId    ${account.accountId}`);
  console.log(`  lawyerId     ${account.lawyerId}`);
  console.log(`  token        ${token}`);
  console.log("");
  console.log("桌面端启用（lawmind.policy.json）：");
  console.log("");
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        edition: "firm",
        matterReplica: {
          enabled: true,
          endpoint: `http://${host}:${port}`,
          cloudToken: token,
        },
      },
      null,
      2,
    ),
  );
  console.log("");
  process.exit(0);
}

const base = await cloud.listen(port, host);
console.log(`[matter-cloud] listening on ${base} (data=${dataDir})`);
console.log("[matter-cloud] 生产部署请置于 TLS / 限流 / 审计代理之后，勿直接暴露明文 HTTP。");
