/**
 * Parse a JSON object while skipping the values of named top-level keys.
 * Used so directory scans do not build conversation history or draft bodies.
 * Returns null when the shape is not a plain object or the walk is unsure;
 * callers then fall back to JSON.parse.
 */

const WS = new Set([" ", "\n", "\r", "\t"]);

function skipWs(raw: string, index: number): number {
  let i = index;
  while (i < raw.length && WS.has(raw[i] ?? "")) {
    i += 1;
  }
  return i;
}

function skipString(raw: string, index: number): number | null {
  if (raw[index] !== '"') {
    return null;
  }
  let i = index + 1;
  while (i < raw.length) {
    const ch = raw[i] ?? "";
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      return i + 1;
    }
    i += 1;
  }
  return null;
}

function skipContainer(raw: string, index: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = index; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return null;
}

function skipLiteral(raw: string, index: number): number | null {
  if (raw.startsWith("true", index)) {
    return index + 4;
  }
  if (raw.startsWith("false", index)) {
    return index + 5;
  }
  if (raw.startsWith("null", index)) {
    return index + 4;
  }
  let i = index;
  if (raw[i] === "-") {
    i += 1;
  }
  if (!/[0-9]/.test(raw[i] ?? "")) {
    return null;
  }
  while (i < raw.length && /[0-9eE+.-]/.test(raw[i] ?? "")) {
    i += 1;
  }
  return i;
}

function skipValue(raw: string, index: number): number | null {
  const i = skipWs(raw, index);
  const ch = raw[i];
  if (ch === '"') {
    return skipString(raw, i);
  }
  if (ch === "{" || ch === "[") {
    return skipContainer(raw, i);
  }
  return skipLiteral(raw, i);
}

export function parseJsonOmittingTopLevelKeys(raw: string, omitKeys: ReadonlySet<string>): unknown {
  try {
    const rebuilt = rebuildObjectOmitting(raw, omitKeys);
    if (rebuilt == null) {
      return null;
    }
    return JSON.parse(rebuilt) as unknown;
  } catch {
    return null;
  }
}

function rebuildObjectOmitting(raw: string, omitKeys: ReadonlySet<string>): string | null {
  let i = skipWs(raw, 0);
  if (raw[i] !== "{") {
    return null;
  }
  i += 1;
  const kept: string[] = [];
  while (i < raw.length) {
    i = skipWs(raw, i);
    if (raw[i] === "}") {
      return `{${kept.join(",")}}`;
    }
    const keyStart = i;
    const keyEnd = skipString(raw, i);
    if (keyEnd == null) {
      return null;
    }
    let key: string;
    try {
      key = JSON.parse(raw.slice(keyStart, keyEnd)) as string;
    } catch {
      return null;
    }
    if (typeof key !== "string") {
      return null;
    }
    i = skipWs(raw, keyEnd);
    if (raw[i] !== ":") {
      return null;
    }
    i += 1;
    const valueStart = skipWs(raw, i);
    const valueEnd = skipValue(raw, valueStart);
    if (valueEnd == null) {
      return null;
    }
    if (!omitKeys.has(key)) {
      kept.push(raw.slice(keyStart, valueEnd));
    }
    i = skipWs(raw, valueEnd);
    if (raw[i] === ",") {
      i += 1;
      continue;
    }
    if (raw[i] === "}") {
      return `{${kept.join(",")}}`;
    }
    return null;
  }
  return null;
}
