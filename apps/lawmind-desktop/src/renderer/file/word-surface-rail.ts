/**
 * Margin balloons share the page scroll. Each card sits at the mark's
 * vertical position, and only moves down when the previous card would overlap it.
 */

export type RailPackSlot = {
  wanted: number;
  height: number;
};

export function packRailCardTops(
  slots: RailPackSlot[],
  gap = 8,
): { tops: number[]; height: number } {
  const indexed = slots.map((slot, index) => ({ ...slot, index }));
  indexed.sort((left, right) => {
    const a = Number.isFinite(left.wanted) ? left.wanted : Number.POSITIVE_INFINITY;
    const b = Number.isFinite(right.wanted) ? right.wanted : Number.POSITIVE_INFINITY;
    return a - b || left.index - right.index;
  });
  const tops = Array.from({ length: slots.length }, () => 0);
  let stack = 0;
  for (const row of indexed) {
    const wanted = Number.isFinite(row.wanted) ? Math.max(0, row.wanted) : stack;
    const top = Math.max(stack, wanted);
    tops[row.index] = top;
    stack = top + Math.max(0, row.height) + gap;
  }
  return { tops, height: slots.length === 0 ? 0 : stack };
}
