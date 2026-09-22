/**
 * Tool 参数 schema 校验 — 自 W2 起从 runtime.ts 抽出，
 * 便于 ToolPolicy pipeline 与历史 runtime 都直接引用，避免循环。
 *
 * Unknown keys: strip (do not hard-fail) so capable models that add extra
 * JSON fields still run; required/type/enum errors remain hard failures.
 */

import type { ToolDefinition } from "./types.js";

function valueMatchesType(
  value: unknown,
  type: ToolDefinition["parameters"][string]["type"],
): boolean {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === type;
}

/**
 * Remove keys not in the tool schema. Mutates `args`.
 * Keeps `__approved` because it is a server-injected capability bit (not in any
 * tool schema); model-supplied copies are stripped earlier at the turn boundary
 * (turn-orchestrator-tool-round), so what survives here is server-set only.
 */
export function stripUnknownToolArguments(
  definition: ToolDefinition,
  args: Record<string, unknown>,
): string[] {
  const unknownKeys = Object.keys(args).filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(definition.parameters, key) && key !== "__approved",
  );
  for (const key of unknownKeys) {
    delete args[key];
  }
  return unknownKeys;
}

export function validateToolArguments(
  definition: ToolDefinition,
  args: Record<string, unknown>,
): string | undefined {
  // Unknown keys are stripped before validate (see argSchemaMiddleware).
  for (const [name, schema] of Object.entries(definition.parameters)) {
    const value = args[name];
    if (schema.required && value === undefined) {
      return `missing required key "${name}"`;
    }
    if (value === undefined) {
      continue;
    }
    if (!valueMatchesType(value, schema.type)) {
      return `key "${name}" expects ${schema.type}`;
    }
    if (schema.enum) {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      if (!schema.enum.includes(str)) {
        return `key "${name}" must be one of: ${schema.enum.join(", ")}`;
      }
    }
  }
  return undefined;
}
