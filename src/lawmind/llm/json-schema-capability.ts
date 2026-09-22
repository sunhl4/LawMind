/**
 * Strict JSON-schema 响应格式的能力判定（P2.1）。
 *
 * 背景：`response_format: { type: "json_object" }` 只保证「产出是 JSON」，
 * 不保证「字段名对、枚举值在集合内」。所以调用方（路由分类、Guardian）至今仍需
 * 自己再校验一遍并把非法值丢掉——`router/model-route.ts` 的 `isTaskKind()` 就是这道补丁。
 *
 * 升级到 `response_format: { type: "json_schema", json_schema: { strict: true } }`
 * 可以把「结构上不可能返回非法值」变成协议保证。但**OpenAI 兼容端点对它的支持并不统一**：
 * 部分厂商只实现了 `json_object`，收到 `json_schema` 会直接 400。
 *
 * 因此本模块的设计原则是**不猜厂商能力**：
 *
 *   1. 默认（`auto`）只对**已核实支持**的端点启用 strict；其余沿用 `json_object`
 *      ——即默认行为与升级前完全一致，不存在「换了个 400」的风险。
 *   2. `on` 时无条件尝试；若端点以 400 拒绝，**进程内记住**并自动回落，
 *      避免每次调用都想试一次（那会把延迟翻倍）。
 *   3. 任何回落都**记录下来**，不静默——静默降级会让「我们以为有结构保证」变成假象。
 *
 * 维护要求：`KNOWN_STRICT_SCHEMA_HOSTS` 是**需要人工核对**的白名单。
 * 厂商上线 strict 支持后把它加进来即可；不确定就不要加（加了会 400）。
 */

export type JsonResponseFormatMode = "json_schema" | "json_object";

export type JsonSchemaDecision = {
  mode: JsonResponseFormatMode;
  /** 人可读的判定理由，进日志/审计用；不要展示给律师。 */
  reason: string;
};

/**
 * 已核实支持 `response_format: {type:"json_schema"}` 的端点主机名。
 *
 * **只放已核实的。** 目前为空数组——即 P2.1 落地后的默认行为与升级前一致，
 * 这是刻意的：能力矩阵需要逐个实测，不能凭印象填。调用方仍可通过
 * `LAWMIND_LLM_JSON_SCHEMA=on` 主动开启探测。
 *
 * 加入条件：对该端点发一次 `json_schema` 请求并确认返回 200 + 符合 schema 的 JSON。
 */
export const KNOWN_STRICT_SCHEMA_HOSTS: ReadonlyArray<string> = [];

/** 进程内记住「这个端点拒绝 strict」——避免每次调用都失败一次。 */
const strictRejectedHosts = new Set<string>();

export function hostOf(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    // 非绝对 URL（测试里的假端点）：退化为手工剥离 scheme/path。
    return raw
      .replace(/^[a-z]+:\/\//i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

/**
 * `LAWMIND_LLM_JSON_SCHEMA`：
 * - `on` / `1` / `true`：无条件尝试 strict（端点拒绝则自动回落并记住）
 * - `off` / `0` / `false`：永不尝试，一律 `json_object`
 * - `auto` / 未设置：只对 `KNOWN_STRICT_SCHEMA_HOSTS` 启用
 */
export function resolveJsonSchemaMode(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): JsonSchemaDecision {
  const raw = (env.LAWMIND_LLM_JSON_SCHEMA ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false" || raw === "no") {
    return { mode: "json_object", reason: "env_forced_off" };
  }
  const host = hostOf(baseUrl);
  if (!host) {
    return { mode: "json_object", reason: "empty_base_url" };
  }
  if (strictRejectedHosts.has(host)) {
    return { mode: "json_object", reason: "previously_rejected" };
  }
  if (raw === "on" || raw === "1" || raw === "true" || raw === "yes") {
    return { mode: "json_schema", reason: "env_forced_on" };
  }
  if (KNOWN_STRICT_SCHEMA_HOSTS.includes(host)) {
    return { mode: "json_schema", reason: "known_supported_host" };
  }
  return { mode: "json_object", reason: "unknown_host_default_json_object" };
}

/**
 * 端点以 400 拒绝 strict 时调用：记住该主机，本次及后续都退回 `json_object`。
 * 返回 true 表示这是**首次**记录（调用方可据此记一次审计/日志）。
 */
export function markStrictSchemaRejected(baseUrl: string): boolean {
  const host = hostOf(baseUrl);
  if (!host || strictRejectedHosts.has(host)) {
    return false;
  }
  strictRejectedHosts.add(host);
  return true;
}

/** 仅测试用：清空进程内记忆。 */
export function resetStrictSchemaRejectionCache(): void {
  strictRejectedHosts.clear();
}

/** 判定某个 400 响应是否像「不支持 strict schema」（与 `guardian/run.ts` 的既有口径一致）。 */
export function looksLikeStrictSchemaRejection(status: number, body: string): boolean {
  if (status !== 400) {
    return false;
  }
  return /json_schema|response_format|strict/i.test(body);
}

/** 供测试与审计复用：当前进程内已被判定拒绝 strict 的主机。 */
export function listStrictSchemaRejectedHosts(): string[] {
  return [...strictRejectedHosts].toSorted();
}
