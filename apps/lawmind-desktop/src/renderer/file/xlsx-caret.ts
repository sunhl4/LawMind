/**
 * Place the caret in an in-cell <input> at the click X (Excel-like insert).
 */

export function caretIndexFromTextWidth(
  value: string,
  x: number,
  measure: (text: string) => number,
): number {
  if (!value || x <= 0) {
    return 0;
  }
  if (measure(value) <= x) {
    return value.length;
  }
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(value.slice(0, mid)) <= x) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

export function caretIndexFromClientX(input: HTMLInputElement, clientX: number): number {
  const style = getComputedStyle(input);
  const rect = input.getBoundingClientRect();
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const x = clientX - rect.left - paddingLeft + input.scrollLeft;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return input.value.length;
  }
  ctx.font = style.font || "11pt sans-serif";
  return caretIndexFromTextWidth(input.value, x, (text) => ctx.measureText(text).width);
}
