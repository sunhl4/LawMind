import type { AuthorityCallStatus } from "../../authority-outcome.js";

type Inspection = { list: boolean; rows: number; error?: AuthorityCallStatus };

function failureKind(message: string, code?: unknown): AuthorityCallStatus {
  if (
    code === 402 ||
    String(code) === "402" ||
    /(?:积分|余额|额度|配额).{0,16}(?:不足|耗尽|用完|为\s*0)|(?:insufficient|exhausted).{0,20}(?:credit|balance|quota)|(?:credit|balance|quota).{0,20}(?:insufficient|exhausted|exceeded)|insufficient_quota/i.test(
      message,
    )
  ) {
    return "quota_exhausted";
  }
  if (String(code) === "429" || /限流|请求过于频繁|rate.?limit|too many requests/i.test(message)) {
    return "rate_limited";
  }
  if (
    ["401", "403"].includes(String(code)) ||
    /鉴权失败|无权访问|未授权|unauthorized|forbidden|invalid.{0,10}(?:token|api.?key)/i.test(
      message,
    )
  ) {
    return "unauthorized";
  }
  return "unavailable";
}

/** Inspect envelopes, not document text (a statute mentioning quota is still a hit). */
function inspect(value: unknown, depth = 0): Inspection {
  if (depth > 6) {
    return { list: false, rows: 0 };
  }
  if (Array.isArray(value)) {
    return { list: true, rows: value.length };
  }
  if (!value || typeof value !== "object") {
    return { list: false, rows: 0 };
  }
  const obj = value as Record<string, unknown>;
  const message = [obj.message, obj.msg, obj.error_description]
    .filter((x): x is string => typeof x === "string")
    .join(" ");
  let error: AuthorityCallStatus | undefined;
  const hasError = obj.error != null && obj.error !== false && obj.error !== "" && obj.error !== 0;
  if (hasError || obj.isError === true || obj.success === false) {
    const errorObj =
      obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : {};
    const texts = Array.isArray(obj.content)
      ? obj.content.flatMap((part: unknown) =>
          part && typeof part === "object" && "text" in part && typeof part.text === "string"
            ? [part.text]
            : [],
        )
      : [];
    error = failureKind(
      [message, errorObj.message, typeof obj.error === "string" ? obj.error : "", ...texts].join(
        " ",
      ),
      errorObj.code ?? obj.code,
    );
  } else if (message || obj.code != null) {
    const specific = failureKind(message, obj.code);
    if (specific !== "unavailable") {
      error = specific;
    } else if (obj.code != null) {
      const codeText =
        typeof obj.code === "string" || typeof obj.code === "number" ? String(obj.code) : "";
      if (codeText && !["0", "200", "OK", "SUCCESS"].includes(codeText.toUpperCase())) {
        error = "unavailable";
      }
    }
  }
  let list = false;
  let rows = 0;
  const children: unknown[] = [
    obj.hits,
    obj.items,
    obj.list,
    obj.data,
    obj.result,
    obj.structuredContent,
  ];
  if (Array.isArray(obj.content)) {
    for (const part of obj.content) {
      if (part && typeof part === "object" && typeof part.text === "string") {
        try {
          children.push(JSON.parse(part.text));
        } catch {
          const specific = failureKind(part.text);
          if (specific !== "unavailable") {
            error = specific;
          }
        }
      }
    }
  }
  for (const child of children) {
    const next = inspect(child, depth + 1);
    list ||= next.list;
    rows += next.rows;
    if (next.error && (!error || error === "unavailable")) {
      error = next.error;
    }
  }
  return { list, rows, error };
}

export function pkulawResponseStatus(body: unknown, hitCount: number): AuthorityCallStatus {
  const evidence = inspect(body);
  if (evidence.error) {
    return evidence.error;
  }
  if (hitCount > 0) {
    return "ok";
  }
  // Only a recognized, explicitly empty result list proves a successful zero-hit search.
  return evidence.list && evidence.rows === 0 ? "empty" : "invalid_response";
}
