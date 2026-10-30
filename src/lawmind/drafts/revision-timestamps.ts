/**
 * Word 修订时间（`w:date`）：真人在一次审阅里不会几秒钟落下几十处修改。
 *
 * LawMind 落修订是毫秒级的，如果每处都写「导出这一刻」，Word 审阅窗格里
 * 一长串修改会显示同一个时间，一眼就是机器批量写的。这里按一次真实审阅的节奏
 * 给每处修订排时间：
 *
 *   - 相邻修改几十秒到一分多钟；
 *   - 换到下一个条款时停一两分钟到几分钟；
 *   - 偶尔停下来查资料/接电话，隔七到二十几分钟；
 *   - 最后一处落在导出前几十秒到几分钟，整体不超过四小时。
 *
 * 只影响 Word 里显示的修订时间。真实导出时刻另由 manifest 的 `exportedAt`
 * 记录，审计口径不受影响。同一个 seed + now 得到同一组时间，便于复现与测试。
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** FNV-1a 32-bit：把任意 seed 变成一个稳定的整数起点。 */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：小、快、确定性的 PRNG，避免依赖 Math.random 导致每次导出都变。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** 两处修改之间的间隔：多数是连续改，少数是读条款，偶尔是长停顿。 */
function pickGap(random: () => number): number {
  const roll = random();
  if (roll < 0.08) {
    return randInt(random, 7 * MINUTE, 25 * MINUTE);
  }
  if (roll < 0.45) {
    return randInt(random, 90 * SECOND, 6 * MINUTE);
  }
  return randInt(random, 15 * SECOND, 75 * SECOND);
}

/** Word 接受 W3CDTF；去掉毫秒，和 Word 自己写的精度一致。 */
export function formatRevisionTimestamp(date: Date): string {
  return new Date(Math.round(date.getTime() / SECOND) * SECOND)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * 给 `count` 处修订排一组严格递增的显示时间。
 *
 * @param seed 稳定种子（例如 taskId + hunkId）。相同 seed/now 结果可复现。
 * @param now 导出时刻；最后一处会落在它之前几十秒到几分钟。
 * @param notBefore 最早可用时间（例如原合同文件的 mtime）。窗口不够时等比例压缩。
 */
export function planRevisionTimestamps(params: {
  count: number;
  seed: string;
  now?: Date;
  notBefore?: Date;
  /** 测试注入；默认用 seed 初始化的确定性 PRNG。 */
  random?: () => number;
}): string[] {
  const count = Math.max(0, Math.floor(params.count));
  if (count === 0) {
    return [];
  }
  const nowMs = (params.now ?? new Date()).getTime();
  const random = params.random ?? mulberry32(hashSeed(params.seed));
  // 导出/保存总要点一下，最后一处不会正好是 now。
  const desiredEndMs = nowMs - randInt(random, 40 * SECOND, 8 * MINUTE);
  const gaps: number[] = [];
  for (let index = 1; index < count; index += 1) {
    gaps.push(pickGap(random));
  }
  let span = gaps.reduce((sum, gap) => sum + gap, 0);

  // 一次坐下来改稿也有上限；超过四小时就整体压回去。
  const maxSpan = 4 * 60 * MINUTE;
  if (span > maxSpan) {
    const scale = maxSpan / span;
    for (let index = 0; index < gaps.length; index += 1) {
      gaps[index] = Math.max(SECOND, Math.round((gaps[index] ?? SECOND) * scale));
    }
    span = gaps.reduce((sum, gap) => sum + gap, 0);
  }

  // 原合同可能是在“导出前几分钟”才保存的。若按理想节奏排出来的结束点早于
  // 基线文件，先把整段审阅往后挪；不能挪到导出之后。
  const rawNotBefore = params.notBefore?.getTime();
  const notBeforeMs =
    rawNotBefore != null && Number.isFinite(rawNotBefore) && rawNotBefore < nowMs
      ? rawNotBefore
      : undefined;
  let endMs = desiredEndMs;
  if (notBeforeMs !== undefined) {
    endMs = Math.min(nowMs - SECOND, Math.max(endMs, notBeforeMs + SECOND));
  }

  // 窗口不够时等比例压缩；连“每秒一处”都放不下时才退到毫秒精度。
  if (notBeforeMs !== undefined) {
    const available = endMs - notBeforeMs;
    if (available <= 0) {
      // 窗口退化（基线在导出瞬间才出现）：只能全部贴在同一时刻，但不早于/晚于边界。
      const at = Math.max(notBeforeMs, Math.min(endMs, nowMs - 1));
      return Array.from({ length: count }, () => formatRevisionTimestamp(new Date(at)));
    }
    if (count > 1 && span > available) {
      const minTotal = (count - 1) * SECOND;
      if (available < minTotal) {
        // 修订条数比可用秒数还多：用毫秒铺开，至少保证都在窗口内且不早于基线。
        return Array.from({ length: count }, (_, index) =>
          new Date(notBeforeMs + Math.round((available * index) / (count - 1))).toISOString(),
        );
      }
      // 每个间隔至少 1 秒，剩余时间按原节奏分配。
      const extra = available - minTotal;
      for (let index = 0; index < gaps.length; index += 1) {
        gaps[index] = SECOND + Math.floor(((gaps[index] ?? SECOND) / span) * extra);
      }
      span = gaps.reduce((sum, gap) => sum + gap, 0);
    }
  }

  const dates: string[] = [];
  let cursor = endMs - span;
  if (notBeforeMs !== undefined && cursor < notBeforeMs) {
    cursor = notBeforeMs;
  }
  for (let index = 0; index < count; index += 1) {
    if (index > 0) {
      cursor += gaps[index - 1] ?? SECOND;
    }
    const previous = dates.at(-1);
    if (previous) {
      const previousMs = Date.parse(previous);
      if (Number.isFinite(previousMs) && cursor <= previousMs) {
        cursor = previousMs + SECOND;
      }
    }
    dates.push(formatRevisionTimestamp(new Date(cursor)));
  }
  return dates;
}
