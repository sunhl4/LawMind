/** Stable signatures shared by tool execution accounting and loop guards. */
export type ToolCallSignatures = Record<
  string,
  { result: string; repeats: number; nudged: boolean; guardNudged?: boolean }
>;

export function stableToolJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableToolJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableToolJson(record[key])}`)
    .join(",")}}`;
}

export function toolCallBatchSignature(
  calls: ReadonlyArray<{ name: string; arguments: unknown }>,
): string {
  return calls.map((call) => `${call.name}\n${stableToolJson(call.arguments)}`).join("\n---\n");
}
