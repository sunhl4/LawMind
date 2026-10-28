/**
 * 证据溯源与独立性融合。
 *
 * 量子类比只取一条在对角态上仍然成立的规则：不可克隆 / 一夫一妻。
 * 同一份原文、同一次工具返回、同一个模型回合只有一份证据；把它复制给两个
 * 子工，不会变成两条独立证据。经典对应物是「只对互不相交的来源根做乘积」。
 *
 * 本模块刻意不 import factor-state：调用方按结构传入已有读数，依赖保持单向。
 * 这样 factor-state 可以 import 本模块，而本模块不反向依赖。
 */

export type EvidenceChannelKind = "tool" | "material" | "model" | "span" | "witness";

export type EvidenceChannel = {
  kind: EvidenceChannelKind;
  /** 产生该证据的稳定 id：工具调用、材料段落、模型回合、原文 span 等。 */
  id: string;
  /** 独立的来源根；缺省为 `${kind}:${id}`。根相同即视为同一份证据。 */
  root?: string;
  /** 该通道给这个读法的正权重；缺省 1。小于 1 表示该通道更支持别的读法。 */
  weight?: number;
};

export type ProvenancedOutcome = {
  id: string;
  mass: number;
  grounded?: boolean;
  span?: string;
  channels?: readonly EvidenceChannel[];
};

export type ProvenanceFusion<T extends ProvenancedOutcome> = {
  outcomes: T[];
  conflict: boolean;
  /** 同时支持两个以上读法的来源根。它们对任何一侧都不算决定性证据。 */
  sharedRoots: string[];
  /** 去重后实际计入每个读法的来源根。 */
  usedRoots: Record<string, string[]>;
};

export type DecisionDistance = {
  id: string;
  /**
   * 要让当前胜出读法翻转，至少需要同时失效几条互不相交的来源根。
   * 共享根不计入，因为它的失效不会改变两侧的相对支持。
   */
  distance: number;
  roots: string[];
};

export function channelRoot(channel: EvidenceChannel): string {
  const root = channel.root?.trim();
  if (root) {
    return root;
  }
  const id = channel.id.trim();
  return id ? `${channel.kind}:${id}` : "";
}

export function channelWeight(channel: EvidenceChannel): number {
  const weight = channel.weight;
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    return 1;
  }
  return weight;
}

export function toolChannel(tool: string, callId: string, weight?: number): EvidenceChannel {
  return { kind: "tool", id: `${tool}:${callId}`, ...(weight === undefined ? {} : { weight }) };
}

export function materialChannel(id: string, weight?: number): EvidenceChannel {
  return { kind: "material", id, ...(weight === undefined ? {} : { weight }) };
}

export function modelChannel(model: string, turnId: string, weight?: number): EvidenceChannel {
  return { kind: "model", id: `${model}:${turnId}`, ...(weight === undefined ? {} : { weight }) };
}

export function spanChannel(sourceId: string, spanHash: string, weight?: number): EvidenceChannel {
  return {
    kind: "span",
    id: `${sourceId}#${spanHash}`,
    ...(weight === undefined ? {} : { weight }),
  };
}

function channelsOf(outcome: ProvenancedOutcome): EvidenceChannel[] {
  return (outcome.channels ?? []).filter((channel) => channelRoot(channel) !== "");
}

/**
 * 只有每个正质量读法都带来源根时，才允许走溯源融合。
 * 否则退回旧的乘积融合，避免把「没登记来源」误当成独立证据。
 */
export function canFuseByProvenance(
  left: readonly ProvenancedOutcome[],
  right: readonly ProvenancedOutcome[],
): boolean {
  const positive = [...left, ...right].filter((row) => row.id.trim() && row.mass > 0);
  return positive.length > 0 && positive.every((row) => channelsOf(row).length > 0);
}

/** 同一读法内同一来源根只算一次；取该根给出的最大权重。 */
function rootWeights(outcome: ProvenancedOutcome): Map<string, number> {
  const weights = new Map<string, number>();
  for (const channel of channelsOf(outcome)) {
    const root = channelRoot(channel);
    weights.set(root, Math.max(weights.get(root) ?? 0, channelWeight(channel)));
  }
  return weights;
}

function rootOwners(
  left: readonly ProvenancedOutcome[],
  right: readonly ProvenancedOutcome[],
): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const outcome of [...left, ...right]) {
    const id = outcome.id.trim();
    if (!id || outcome.mass <= 0) {
      continue;
    }
    for (const root of rootWeights(outcome).keys()) {
      const ids = owners.get(root) ?? new Set<string>();
      ids.add(id);
      owners.set(root, ids);
    }
  }
  return owners;
}

/** 同时支持两个以上读法的来源根。共享根不能给任何一侧加倍。 */
export function sharedEvidenceRoots(
  left: readonly ProvenancedOutcome[],
  right: readonly ProvenancedOutcome[],
): string[] {
  return [...rootOwners(left, right).entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([root]) => root)
    .toSorted();
}

/**
 * 仅对互不相交、且不跨读法共享的来源根做乘积。
 * 同根重复不放大；跨读法共享的根被排除；没有剩余根的读法不存活。
 */
export function fuseProvenancedOutcomes<T extends ProvenancedOutcome>(
  left: readonly T[],
  right: readonly T[],
): ProvenanceFusion<T> {
  const shared = new Set(sharedEvidenceRoots(left, right));
  const ids = new Set<string>([
    ...left.map((row) => row.id.trim()),
    ...right.map((row) => row.id.trim()),
  ]);
  const rows: T[] = [];
  const usedRoots: Record<string, string[]> = {};
  for (const id of ids) {
    if (!id) {
      continue;
    }
    const sides = [
      left.find((row) => row.id.trim() === id),
      right.find((row) => row.id.trim() === id),
    ].filter((row): row is T => Boolean(row));
    if (sides.length === 0) {
      continue;
    }
    const weights = new Map<string, number>();
    const channels = new Map<string, EvidenceChannel>();
    for (const side of sides) {
      for (const [root, weight] of rootWeights(side)) {
        if (shared.has(root)) {
          continue;
        }
        weights.set(root, Math.max(weights.get(root) ?? 0, weight));
      }
      for (const channel of channelsOf(side)) {
        const root = channelRoot(channel);
        if (shared.has(root)) {
          continue;
        }
        const previous = channels.get(root);
        if (!previous || channelWeight(channel) > channelWeight(previous)) {
          channels.set(root, channel);
        }
      }
    }
    const roots = [...weights.keys()].toSorted();
    if (roots.length === 0) {
      continue;
    }
    const weight = roots.reduce((product, root) => product * (weights.get(root) ?? 1), 1);
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const span = sides.find((side) => side.span?.trim())?.span?.trim() ?? "";
    rows.push({
      ...sides[0],
      id,
      mass: weight,
      grounded: sides.every((side) => side.grounded === true),
      ...(span ? { span } : {}),
      channels: [...channels.values()],
    });
    usedRoots[id] = roots;
  }
  const total = rows.reduce((sum, row) => sum + row.mass, 0);
  const normalized = total > 0 ? rows.map((row) => ({ ...row, mass: row.mass / total })) : [];
  const leftIds = new Set(left.map((row) => row.id.trim()).filter(Boolean));
  const rightIds = new Set(right.map((row) => row.id.trim()).filter(Boolean));
  const disjoint =
    leftIds.size > 0 && rightIds.size > 0 && [...leftIds].every((id) => !rightIds.has(id));
  const survivingLeft = normalized.some((row) => leftIds.has(row.id));
  const survivingRight = normalized.some((row) => rightIds.has(row.id));
  return {
    outcomes: normalized,
    conflict: normalized.length === 0 || (disjoint && survivingLeft && survivingRight),
    sharedRoots: [...shared].toSorted(),
    usedRoots,
  };
}

/** 某读法名下互不相交的来源根数量。单条原文再长也只是 1。 */
export function independentSupport(outcome: ProvenancedOutcome): number {
  return rootWeights(outcome).size;
}

/**
 * 决策距离：胜出读法独有的来源根数量。
 * 距离 1 表示只要那一份证据错了，结论就翻；距离 2 才谈得上冗余。
 * 这是「码距」在证据图上的普通计算机版本，不承诺纠错阈值。
 */
export function decisionDistance(outcomes: readonly ProvenancedOutcome[]): DecisionDistance {
  const positive = outcomes.filter((row) => row.id.trim() && row.mass > 0);
  if (positive.length === 0) {
    return { id: "", distance: 0, roots: [] };
  }
  const shared = new Set(sharedEvidenceRoots(positive, []));
  const byId = new Map<string, Set<string>>();
  for (const outcome of positive) {
    const id = outcome.id.trim();
    const roots = new Set([...rootWeights(outcome).keys()].filter((root) => !shared.has(root)));
    byId.set(id, roots);
  }
  const top = positive.toSorted((a, b) => b.mass - a.mass)[0];
  if (!top) {
    return { id: "", distance: 0, roots: [] };
  }
  const runnerUp = positive
    .filter((row) => row.id.trim() !== top.id.trim())
    .toSorted((a, b) => b.mass - a.mass)[0];
  if (runnerUp && Math.abs(top.mass - runnerUp.mass) < 1e-9) {
    return { id: "", distance: 0, roots: [] };
  }
  const topId = top.id.trim();
  const others = new Set<string>();
  for (const [id, roots] of byId) {
    if (id === topId) {
      continue;
    }
    for (const root of roots) {
      others.add(root);
    }
  }
  const unique = [...(byId.get(topId) ?? [])].filter((root) => !others.has(root)).toSorted();
  return { id: topId, distance: unique.length, roots: unique };
}
