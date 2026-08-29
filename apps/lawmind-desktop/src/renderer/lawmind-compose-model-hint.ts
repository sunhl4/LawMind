const COMPOSE_HINT_WARN_RE = /失败|错误|无法|未通过/;

/** Maps compose model status text to callout surface classes (keeps `.lm-compose-model-hint` spacing). */
export function composeModelHintCalloutClass(
  hint: string | null | undefined,
  busy: boolean,
  extraClass = "",
): string {
  const text = (hint ?? "").trim();
  const variant =
    busy && !text
      ? "lm-callout-info"
      : COMPOSE_HINT_WARN_RE.test(text)
        ? "lm-callout-warn"
        : "lm-callout-info";
  const base = `lm-callout ${variant} lm-compose-model-hint`;
  return extraClass ? `${base} ${extraClass}` : base;
}
