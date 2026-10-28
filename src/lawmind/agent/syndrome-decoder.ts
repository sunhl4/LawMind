/**
 * 最小权重综合征译码器。
 *
 * 现状是「红灯按类别套替换规则」：金额红灯修金额，引用红灯修引用。它丢掉了
 * 最有价值的一条信息——两盏红灯是否由同一处笔误造成。量子纠错的译码步骤
 * 在普通计算机上的对应物，就是「找一组总权重最小的故障，使它能解释全部
 * 红灯，且不弄绿变红」。
 *
 * 本模块只做确定性搜索，不调用模型：
 * - 故障候选由稳定子类型生成，权重是负对数先验；
 * - 搜索规模默认不超过 3 个故障、24 个候选；
 * - 同价解释不选边，返回 ambiguous；
 * - 没有解释能覆盖红灯时返回 uncorrectable，交回上层标【待核实】。
 *
 * 不承诺量子加速。这是集合覆盖 / 最小权重解释的经典算法。
 */

export type SyndromeBit = {
  stabilizer: string;
  anchor: string;
  /** 同一锚上可能有多条核对项；缺省按 stabilizer + anchor 计。 */
  check?: string;
  detail?: string;
};

export type SyndromeRound = {
  round: number;
  bits: readonly SyndromeBit[];
};

export type FaultKind =
  | "proposal_wrong"
  | "reading_wrong"
  | "source_missing"
  | "span_mismatch"
  | "calculation_wrong"
  | "definition_drift"
  | "party_drift"
  | "redline_empty"
  | "redline_whole_sentence"
  | "correlated_reuse";

export type Fault = {
  id: string;
  kind: FaultKind;
  anchors: readonly string[];
  /** 该故障能解释的红灯键（syndromeKey）。 */
  explains: readonly string[];
  /** 该故障会弄红的其他核对项；译码时不得触碰绿项。 */
  breaks?: readonly string[];
  /** 负对数先验；越小越可能。 */
  weight: number;
  /** 给修复回路的内部说明，不直接给律师。 */
  note?: string;
};

export type DecodeResult =
  | {
      kind: "unique";
      faults: Fault[];
      cost: number;
      /** 只重做这些锚。 */
      repairAnchors: string[];
      /** 修完复查这些稳定子。 */
      recheck: string[];
    }
  | {
      kind: "ambiguous";
      candidates: Fault[][];
      reason: string;
      /** 所有候选都同意的锚；只可复查，不可自动修。 */
      repairAnchors: string[];
      recheck: string[];
    }
  | { kind: "uncorrectable"; reason: string; recheck: string[] };

export type DecodeOptions = {
  maxFaults?: number;
  maxCandidates?: number;
  maxCombinations?: number;
  epsilon?: number;
  /** 当前为绿、不得被故障弄红的核对键。 */
  greenChecks?: readonly string[];
};

export type FaultWeightTable = Partial<Record<FaultKind, number>>;

const DEFAULT_WEIGHTS: Record<FaultKind, number> = {
  proposal_wrong: 1,
  reading_wrong: 1.2,
  source_missing: 1.4,
  span_mismatch: 1.3,
  calculation_wrong: 1.5,
  definition_drift: 1,
  party_drift: 1,
  redline_empty: 1,
  redline_whole_sentence: 1.4,
  correlated_reuse: 1.1,
};

export function syndromeKey(bit: SyndromeBit): string {
  return `${bit.stabilizer}::${bit.anchor}::${bit.check ?? ""}`;
}

function uniqueKeys(bits: readonly SyndromeBit[]): string[] {
  return [...new Set(bits.map(syndromeKey))].toSorted();
}

function weightOf(kind: FaultKind, weights?: FaultWeightTable): number {
  const custom = weights?.[kind];
  if (custom !== undefined && Number.isFinite(custom) && custom > 0) {
    return custom;
  }
  return DEFAULT_WEIGHTS[kind];
}

function fault(kind: FaultKind, anchor: string, key: string, weight: number, note: string): Fault {
  return {
    id: `${kind}:${anchor}:${key}`,
    kind,
    anchors: [anchor],
    explains: [key],
    weight,
    note,
  };
}

/**
 * 由红灯生成候选故障。候选只覆盖已知锚，不猜新锚。
 * 同一锚上的多条红灯另有一条 correlated_reuse 候选，用来表达「同一处笔误
 * 同时点亮两盏灯」；它的权重低于两条独立故障之和，因此译码器会优先选它。
 */
export function buildFaultCandidates(
  syndrome: readonly SyndromeBit[],
  options: { weights?: FaultWeightTable } = {},
): Fault[] {
  const byId = new Map<string, Fault>();
  const weights = options.weights;
  const add = (row: Fault) => {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  };
  for (const bit of syndrome) {
    const key = syndromeKey(bit);
    const anchor = bit.anchor.trim();
    if (!anchor) {
      continue;
    }
    if (bit.stabilizer === "S1") {
      add(
        fault(
          "proposal_wrong",
          anchor,
          key,
          weightOf("proposal_wrong", weights),
          `引用「${anchor}」的稿中说法与来源包不符`,
        ),
      );
      add(
        fault(
          "source_missing",
          anchor,
          key,
          weightOf("source_missing", weights),
          `引用「${anchor}」可能根本没检索到`,
        ),
      );
      add(
        fault(
          "span_mismatch",
          anchor,
          key,
          weightOf("span_mismatch", weights),
          `引用「${anchor}」的原文没有对上条号`,
        ),
      );
      continue;
    }
    if (bit.stabilizer === "S2") {
      add(
        fault(
          "proposal_wrong",
          anchor,
          key,
          weightOf("proposal_wrong", weights),
          `金额槽「${anchor}」的稿中读数与账本不符`,
        ),
      );
      add(
        fault(
          "calculation_wrong",
          anchor,
          key,
          weightOf("calculation_wrong", weights),
          `金额槽「${anchor}」可能是计算器输入或结果本身有误`,
        ),
      );
      continue;
    }
    if (bit.stabilizer === "S3") {
      add(
        fault(
          "redline_empty",
          anchor,
          key,
          weightOf("redline_empty", weights),
          `修订「${anchor}」可能根本没有落进修订轨`,
        ),
      );
      add(
        fault(
          "redline_whole_sentence",
          anchor,
          key,
          weightOf("redline_whole_sentence", weights),
          `修订「${anchor}」可能是整句删加整句增`,
        ),
      );
      continue;
    }
    if (bit.stabilizer === "S4") {
      const partyAnchor = anchor.startsWith("party:");
      const definedAnchor = anchor.startsWith("defined:");
      add(
        fault(
          "definition_drift",
          anchor,
          key,
          weightOf("definition_drift", weights) * (definedAnchor ? 0.9 : 1.2),
          `定义项「${anchor}」的使用点与定义不一致`,
        ),
      );
      add(
        fault(
          "party_drift",
          anchor,
          key,
          weightOf("party_drift", weights) * (partyAnchor ? 0.9 : 1.2),
          `当事人称谓「${anchor}」在本件中没有定义`,
        ),
      );
      add(
        fault(
          "proposal_wrong",
          anchor,
          key,
          weightOf("proposal_wrong", weights) * (partyAnchor || definedAnchor ? 1 : 0.9),
          `称谓「${anchor}」可能是模型自己写出来的`,
        ),
      );
      continue;
    }
    add(
      fault(
        "proposal_wrong",
        anchor,
        key,
        weightOf("proposal_wrong", weights),
        `锚「${anchor}」的稿中说法与账本不符`,
      ),
    );
    add(
      fault(
        "reading_wrong",
        anchor,
        key,
        weightOf("reading_wrong", weights),
        `锚「${anchor}」的账本读数本身可能错了`,
      ),
    );
  }
  const byAnchor = new Map<string, SyndromeBit[]>();
  for (const bit of syndrome) {
    const anchor = bit.anchor.trim();
    if (!anchor) {
      continue;
    }
    const rows = byAnchor.get(anchor) ?? [];
    rows.push(bit);
    byAnchor.set(anchor, rows);
  }
  for (const [anchor, bits] of byAnchor) {
    if (bits.length < 2) {
      continue;
    }
    const keys = uniqueKeys(bits);
    add({
      id: `correlated_reuse:${anchor}`,
      kind: "correlated_reuse",
      anchors: [anchor],
      explains: keys,
      weight: Math.min(1.5, weightOf("correlated_reuse", weights) * bits.length),
      note: `同一锚「${anchor}」上的 ${bits.length} 盏红灯可能由一处错误同时造成`,
    });
  }
  return [...byId.values()].toSorted((a, b) => a.weight - b.weight || a.id.localeCompare(b.id));
}

function combinations<T>(items: readonly T[], size: number, cap: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number) => {
    if (out.length >= cap) {
      return;
    }
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      pick.push(item);
      walk(index + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

function unionAnchors(faults: readonly Fault[]): string[] {
  return [...new Set(faults.flatMap((row) => row.anchors.map((anchor) => anchor.trim())))]
    .filter(Boolean)
    .toSorted();
}

function unionRecheck(bits: readonly SyndromeBit[]): string[] {
  return [...new Set(bits.map((bit) => bit.stabilizer.trim()).filter(Boolean))].toSorted();
}

export function decodeSyndrome(
  syndrome: readonly SyndromeBit[],
  faults: readonly Fault[],
  options: DecodeOptions = {},
): DecodeResult {
  const bits = syndrome.filter((bit) => bit.anchor.trim());
  const required = uniqueKeys(bits);
  if (required.length === 0) {
    return { kind: "uncorrectable", reason: "没有红灯", recheck: [] };
  }
  const green = new Set(options.greenChecks ?? []);
  const maxFaults = Math.max(1, options.maxFaults ?? 3);
  const maxCandidates = Math.max(1, options.maxCandidates ?? 24);
  const epsilon = Math.max(0, options.epsilon ?? 1e-9);
  const maxCombinations = Math.max(1, options.maxCombinations ?? 20_000);
  const requiredSet = new Set(required);
  const candidates = faults
    .filter((row) => row.explains.some((key) => requiredSet.has(key)))
    .filter((row) => !(row.breaks ?? []).some((key) => green.has(key)))
    .filter((row) => row.anchors.some((anchor) => anchor.trim()))
    .toSorted((a, b) => a.weight - b.weight || a.id.localeCompare(b.id))
    .slice(0, maxCandidates);
  let bestCost = Number.POSITIVE_INFINITY;
  let bestSize = Number.POSITIVE_INFINITY;
  let best: Fault[][] = [];
  for (let size = 1; size <= Math.min(maxFaults, candidates.length); size += 1) {
    for (const combo of combinations(candidates, size, maxCombinations)) {
      const covered = new Set<string>();
      let cost = 0;
      let touchesGreen = false;
      for (const row of combo) {
        cost += row.weight;
        for (const key of row.explains) {
          covered.add(key);
        }
        if ((row.breaks ?? []).some((key) => green.has(key))) {
          touchesGreen = true;
          break;
        }
      }
      if (touchesGreen) {
        continue;
      }
      if ([...requiredSet].some((key) => !covered.has(key))) {
        continue;
      }
      if (cost < bestCost - epsilon) {
        bestCost = cost;
        bestSize = size;
        best = [[...combo]];
        continue;
      }
      if (Math.abs(cost - bestCost) <= epsilon) {
        if (size < bestSize) {
          bestSize = size;
          best = [[...combo]];
          continue;
        }
        if (size === bestSize) {
          best.push([...combo]);
        }
      }
    }
  }
  const recheck = unionRecheck(bits);
  if (best.length === 0) {
    return {
      kind: "uncorrectable",
      reason: `没有候选故障能覆盖 ${required.length} 盏红灯`,
      recheck,
    };
  }
  if (best.length > 1) {
    const candidateAnchors = best.map(unionAnchors);
    const common = candidateAnchors[0]?.filter((anchor) =>
      candidateAnchors.every((anchors) => anchors.includes(anchor)),
    );
    return {
      kind: "ambiguous",
      candidates: best.slice(0, 5),
      reason: `${best.length} 组解释同价，不选边`,
      repairAnchors: common ?? [],
      recheck,
    };
  }
  const chosen = best[0] ?? [];
  return {
    kind: "unique",
    faults: chosen,
    cost: bestCost,
    repairAnchors: unionAnchors(chosen),
    recheck,
  };
}

/** 跨轮弱测量：同一盏红灯至少在最近 window 轮中的 minRounds 轮出现，才算持续。 */
export function persistentSyndrome(
  history: readonly SyndromeRound[],
  options: { window?: number; minRounds?: number } = {},
): SyndromeBit[] {
  const window = Math.max(1, options.window ?? 3);
  const minRounds = Math.max(1, options.minRounds ?? 2);
  const recent = history.toSorted((a, b) => a.round - b.round).slice(-window);
  if (recent.length === 0) {
    return [];
  }
  const counts = new Map<string, { count: number; bit: SyndromeBit }>();
  for (const round of recent) {
    const seen = new Set<string>();
    for (const bit of round.bits) {
      const key = syndromeKey(bit);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const row = counts.get(key) ?? { count: 0, bit };
      row.count += 1;
      row.bit = bit;
      counts.set(key, row);
    }
  }
  return [...counts.values()]
    .filter((row) => row.count >= minRounds)
    .map((row) => row.bit)
    .toSorted((a, b) => syndromeKey(a).localeCompare(syndromeKey(b)));
}

/** 渲染为内部修复说明。不含「量子」字样，也不面向律师。 */
export function describeDecode(result: DecodeResult): string {
  if (result.kind === "unique") {
    const notes = result.faults.map((row) => row.note ?? row.id);
    return [
      `【译码】${result.faults.length} 处故障可解释全部红灯：${notes.join("；")}。`,
      `只重做：${result.repairAnchors.join("、") || "无"}；复查：${result.recheck.join("、") || "无"}。`,
    ].join("\n");
  }
  if (result.kind === "ambiguous") {
    const ids = result.candidates.map((rows) => rows.map((row) => row.id).join(" + "));
    return [
      `【译码待定】${result.reason}：${ids.join(" | ")}。`,
      `只可复查：${result.repairAnchors.join("、") || "无"}；不要自动重写。`,
    ].join("\n");
  }
  return `【译码无解】${result.reason}；保留【待核实】，不猜。`;
}
