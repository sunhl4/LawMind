/**
 * `local-api-credentials.mjs` 的类型声明。
 *
 * 为什么需要单独一份 `.d.mts`，而不是把 `.mjs` 纳入编译：
 * 它是桌面的**运行时**产物模块（Electron 侧直接加载，不经打包），
 * 所以不适合为了让 TS 看懂而改写成 `.ts`；而 server 侧要 import 它做认证，
 * 没有声明就是 `any`——那正是上一轮「IPC 载荷键名被误改」那类 bug 的温床
 * （键名写错在 `any` 上不会报错，只在真机上表现为「应用无法使用」）。
 *
 * 因此这里按模块**实际实现**逐条声明（纯类型，不改运行时）。修改 `.mjs` 的
 * 导出入参时，请同步改这一份——`tsconfig.desktop-node.json` 会因此报错，
 * 这正是我们要的信号。
 */

/** 四个受派生管辖的客户端。注意**不含** `shared`（旧式单一令牌，仅 dev/E2E 覆盖）。 */
export declare const LOCAL_API_CLIENTS: readonly ["desktop", "renderer", "word-addin", "cli"];

export type LocalApiClientId = (typeof LOCAL_API_CLIENTS)[number];

/** 旧式单一令牌（`LAWMIND_LOCAL_API_TOKEN`）的身份标识。 */
export declare const LEGACY_SHARED_CLIENT: "shared";

/** 轮换宽限代数：验签时同时接受 `epoch` 与 `epoch - grace`。 */
export declare const LOCAL_API_EPOCH_GRACE: number;

/** 派生某一客户端在某一代的凭据（纯函数，两端算出同一个值）。 */
export declare function deriveLocalApiCredential(
  installationSecret: unknown,
  clientId: unknown,
  epoch: unknown,
): string;

/** 常量时间比较；长度不同直接短路。 */
export declare function credentialsEqual(provided: unknown, expected: unknown): boolean;

/** 反查凭据属于哪个客户端；命中返回 clientId，否则 `null`。 */
export declare function resolveClientFromCredential(
  installationSecret: unknown,
  provided: unknown,
  epoch: unknown,
  opts?: { revoke?: readonly string[]; grace?: number },
): LocalApiClientId | null;

/** 取某一客户端在当前代的凭据（服务端下发用）。 */
export declare function credentialForClient(
  installationSecret: unknown,
  clientId: unknown,
  epoch: unknown,
): string;

/** 每客户端最小权限（默认拒绝）。 */
export declare function isClientAllowedForRequest(
  clientId: unknown,
  method: unknown,
  pathname: unknown,
): boolean;

/** 本机发现端点路径。 */
export declare const LOCAL_API_DISCOVERY_PATH: string;
