/**
 * 本机 API 凭据派生 —— **唯一真相源**（Electron 主进程与本机服务共用这一个模块）。
 *
 * ## 为什么需要它（而不是继续用「一把共享令牌」）
 *
 * 2026-09-21 实测故障：Word 任务窗格报 `unauthorized`，且此后每次 LawMind 重启都复发。
 * 根因不是鉴权写错，而是**一把「每进程随机、只下发一次」的共享令牌同时服务四种能力
 * 完全不同的客户端**。三个事实相乘：
 *
 *   1. 端口是**持久化**的（`desktop-config.json` 的 `apiPort`）—— 这是有意为之，
 *      为的是侧载清单里写死的地址不因重启失效；
 *   2. 而令牌是**进程级**的（每次启动 `randomBytes(32)`）；
 *   3. 加载项只在**页面加载时**取一次令牌（CSP 只放行同源脚本，没有第二条投递通道）。
 *
 * 于是必然出现「地址不变、钥匙变了」⇒ 重启后所有已打开的窗格一律 401，且客户端
 * 无处重新发现新钥匙，只能人工重载窗格。
 *
 * 更根本的一处：共享令牌在**结构上**回答不了「这次改稿是从 Word 来的，还是从桌面端
 * 来的」—— 审计只能记 `actorId`（是谁），记不出来源（从哪来）。对一个把审计链当
 * 核心的产品，这是实质缺口，且只有引入客户端身份才能修。
 *
 * ## 设计
 *
 *   安装密钥（持久）→ 按 clientId 派生凭据 → 服务端按 clientId 现算比对
 *
 *   credential(clientId, epoch) = HMAC-SHA256(installationSecret, `${clientId}:${epoch}`)
 *
 * 三个好处：
 *
 *   - **跨重启稳定**：密钥持久化 ⇒ 同一 clientId 的凭据不变 ⇒ 窗格不再被打断。
 *   - **可归属**：服务端比对时就知道来的是哪个客户端 ⇒ 审计多一维，且可挂 scope。
 *   - **可单独吊销**：`revoke` 撤单个客户端；`epoch += 1` 撤全部。
 *
 * 服务端**不存**任何每客户端凭据 —— 验签时现算（`timingSafeEqual` 常量时间比较），
 * 所以吊销与轮换都只是「改名单 / 加一个整数」，不需要迁移任何存储。
 *
 * ## 为什么不直接用 OAuth + PKCE
 *
 * 业界把回环 + PKCE 当默认答案（RFC 8252 / MCP 授权规范，Codex、VS Code、Claude Code
 * 在**远端**授权场景都用它）。但 PKCE 防的是「授权码被本机其他 app 截走」，而这里的
 * AS 与 RS 是同一个进程、授权码本身就是发给自己的令牌 —— 防了个寂寞。等 LawMind 真把
 * 自己作为 MCP server 暴露给外部 agent 时再上；届时发现端点（见 §发现）已经就位。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 已知客户端。新增客户端必须同时给出 scope（见 `isClientAllowedForRequest`），
 * 否则默认拒绝 —— 白名单是加法，不是减法。
 *
 * 注意：这里**不含** `shared`。`shared` 是 `LAWMIND_LOCAL_API_TOKEN` 传入的
 * 旧式单一令牌，只作为 dev/E2E 覆盖路径存在（见 `resolveLoopbackClient`），
 * 不参与派生，也不在轮换/吊销的管辖内。
 */
export const LOCAL_API_CLIENTS = ["desktop", "renderer", "word-addin", "cli"];

/** 旧式单一令牌（`LAWMIND_LOCAL_API_TOKEN`）的身份标识：仅 dev/E2E 覆盖路径。 */
export const LEGACY_SHARED_CLIENT = "shared";

/**
 * 轮换宽限：验签时同时接受 `epoch` 与 `epoch-1`。
 *
 * 为什么需要：轮换若立即生效，所有在途客户端会在同一瞬间集体 401。给一代宽限，
 * 客户端可在下一次发现时自愈，而不是一起炸掉。宽限有界（默认一代），不是无限期。
 */
export const LOCAL_API_EPOCH_GRACE = 1;

/** 派生一个客户端在某一代的凭据。纯函数：两端算出同一个值即可，无需共享存储。 */
export function deriveLocalApiCredential(installationSecret, clientId, epoch) {
  return createHmac("sha256", String(installationSecret))
    .update(`${clientId}:${epoch}`)
    .digest("hex");
}

/** 常量时间比较；长度不同直接短路（不泄露内容，长度本身不是秘密）。 */
export function credentialsEqual(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * 反查凭据属于哪个客户端。命中即认证通过，返回 clientId；否则 null。
 *
 * 遍历顺序固定在 `LOCAL_API_CLIENTS`（不依赖调用方输入），且每次都是常量时间比较，
 * 所以失败路径不泄露「接近哪个客户端」。
 */
export function resolveClientFromCredential(installationSecret, provided, epoch, opts = {}) {
  if (typeof provided !== "string" || !provided.trim()) {
    return null;
  }
  const secret = typeof installationSecret === "string" ? installationSecret.trim() : "";
  if (!secret) {
    return null;
  }
  const revoke = new Set(opts.revoke ?? []);
  const grace = Number.isInteger(opts.grace) ? opts.grace : LOCAL_API_EPOCH_GRACE;
  const current = Number.isInteger(epoch) && epoch > 0 ? epoch : 1;

  const epochs = [];
  for (let i = 0; i <= grace; i += 1) {
    if (current - i >= 1) {
      epochs.push(current - i);
    }
  }

  for (const clientId of LOCAL_API_CLIENTS) {
    if (revoke.has(clientId)) {
      continue;
    }
    for (const e of epochs) {
      if (credentialsEqual(provided, deriveLocalApiCredential(secret, clientId, e))) {
        return clientId;
      }
    }
  }
  return null;
}

/** 取某一个客户端在当前代的凭据（服务端下发用）。 */
export function credentialForClient(installationSecret, clientId, epoch) {
  return deriveLocalApiCredential(installationSecret, clientId, epoch);
}

function isAddinSurface(pathname) {
  return pathname.startsWith("/word-addin/") || pathname.startsWith("/api/word-addin/");
}

/**
 * 每客户端最小权限（P3）。**默认拒绝**：未知客户端、未知路径一律不放行。
 *
 * - `desktop` / `renderer`：本机桌面自己，全量（桌面端就是这套 API 的一等公民）。
 * - `word-addin`：只碰插件自己的两条面。跨面即 403 —— 插件是被 Word 加载的第三方
 *   运行环境，权限越窄越好；它的诉求本来就只有「审这份 / 取结果 / 记案卷」。
 * - `cli`：只读。脚本与排障要的是看状态，不是改案卷；写操作请走桌面端或明确的客户端。
 *
 * 注意：静态面 `/word-addin/*` 的 GET 在 dispatch 里本就免 bearer（Word 取页面时还没有
 * 令牌，鸡生蛋），这里覆盖的是**数据面**与插件可能发起的其余请求。
 */
export function isClientAllowedForRequest(clientId, method, pathname) {
  const verb = String(method ?? "GET").toUpperCase();
  const p = typeof pathname === "string" ? pathname : "";

  switch (clientId) {
    case "desktop":
    case "renderer":
      return true;
    // 旧式共享令牌：语义与本次改造前完全一致（全量），只服务 dev/E2E 覆盖路径。
    // 打包版仍强制鉴权（`LAWMIND_SKIP_API_AUTH` 被忽略），此处不影响生产边界。
    case "shared":
      return true;
    case "word-addin":
      return isAddinSurface(p);
    case "cli":
      return verb === "GET" || verb === "HEAD" || verb === "OPTIONS";
    default:
      return false;
  }
}

/** 发现端点的固定路径（免 bearer，但仍受回环 Host 校验；不含任何秘密）。 */
export const LOCAL_API_DISCOVERY_PATH = "/.well-known/lawmind-local";
