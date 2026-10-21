/**
 * 工具表指纹与固定税估算。
 *
 * 两件事都是为了回答一个问题：**这一轮发出去的请求，前缀有没有变、有多大。**
 *   - 指纹：工具集合或描述一变，多数上游的前缀缓存就从那一段失效；
 *   - 固定税：系统提示 + 工具 schema 是每轮都要重发的固定成本，
 *     混在总输入里就永远说不清「模型贵在哪」。
 *
 * 只做估算，不假装精确：估算值一律标注为 estimate，可被上游 usage 校正。
 */

import { createHash } from "node:crypto";
import { estimateTextTokens } from "../agent/context-budget.js";

/** 稳定序列化：对象键排序，避免同义对象产生不同指纹。 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

/**
 * 工具表指纹。同一组工具 + 同一份描述 → 同一指纹。
 * 用于：账本里关联「这次请求的前缀长什么样」，以及事后验证前缀是否稳定。
 */
export function toolTableFingerprint(tools: readonly unknown[]): string {
  if (tools.length === 0) {
    return "no-tools";
  }
  return createHash("sha256").update(stableJson(tools)).digest("hex").slice(0, 16);
}

/**
 * 工具 schema 的 token 估算。
 *
 * 这是「固定税」里最容易失控的一块：工具越多、描述越长，每轮都要付一次。
 * 用与预算同一套估算器，保证和 `token_budget` 的口径一致。
 */
export function estimateToolSchemaTokens(tools: readonly unknown[]): number {
  if (tools.length === 0) {
    return 0;
  }
  return estimateTextTokens(stableJson(tools));
}

/** 按指纹缓存工具 schema 估算：同一轮工具表不变时不重复 stringify。 */
export class ToolTableMeter {
  private last?: { fingerprint: string; tokens: number };

  measure(tools: readonly unknown[]): { fingerprint: string; tokens: number } {
    const fingerprint = toolTableFingerprint(tools);
    if (this.last?.fingerprint === fingerprint) {
      return this.last;
    }
    const measured = { fingerprint, tokens: estimateToolSchemaTokens(tools) };
    this.last = measured;
    return measured;
  }
}
