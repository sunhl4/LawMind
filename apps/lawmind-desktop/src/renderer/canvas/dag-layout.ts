export type DAGLayoutOptions = {
  nodes: Array<{ id: string }>;
  edges: Array<{ from: string; to: string }>;
  direction?: "vertical" | "horizontal";
  nodeWidth?: number;
  nodeHeight?: number;
  rankGap?: number;
  nodeGap?: number;
  padding?: number;
};

export type DAGLayoutNode = {
  id: string;
  x: number;
  y: number;
  rank: number;
  order: number;
};

export type DAGLayoutEdge = {
  from: string;
  to: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  isBackEdge: boolean;
};

export type DAGLayoutRank = {
  rank: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
};

export type DAGLayoutResult = {
  nodes: DAGLayoutNode[];
  edges: DAGLayoutEdge[];
  ranks: DAGLayoutRank[];
  direction: "vertical" | "horizontal";
  width: number;
  height: number;
};

function edgeKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

/**
 * Rank nodes top-to-bottom (or left-to-right). Cycles are flagged as back-edges
 * and kept out of the ranking so the remaining graph stays layered.
 */
export function computeDAGLayout(options: DAGLayoutOptions): DAGLayoutResult {
  const direction = options.direction ?? "vertical";
  const nodeWidth = options.nodeWidth ?? 160;
  const nodeHeight = options.nodeHeight ?? 40;
  const rankGap = options.rankGap ?? 64;
  const nodeGap = options.nodeGap ?? 48;
  const padding = options.padding ?? 24;
  const ids = options.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const rawEdges = options.edges.filter(
    (edge) => idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to,
  );

  const color = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const outgoingAll = new Map<string, string[]>();
  for (const id of ids) {
    outgoingAll.set(id, []);
  }
  for (const edge of rawEdges) {
    outgoingAll.get(edge.from)?.push(edge.to);
  }
  const visit = (id: string) => {
    color.set(id, 1);
    for (const next of outgoingAll.get(id) ?? []) {
      const mark = color.get(next) ?? 0;
      if (mark === 1) {
        back.add(edgeKey(id, next));
      } else if (mark === 0) {
        visit(next);
      }
    }
    color.set(id, 2);
  };
  for (const id of ids) {
    if ((color.get(id) ?? 0) === 0) {
      visit(id);
    }
  }

  const incoming = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
  }
  for (const edge of rawEdges) {
    if (!back.has(edgeKey(edge.from, edge.to))) {
      incoming.get(edge.to)?.push(edge.from);
    }
  }

  const rank = new Map<string, number>();
  const ranking = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) {
      return known;
    }
    if (ranking.has(id)) {
      return 0;
    }
    ranking.add(id);
    const preds = incoming.get(id) ?? [];
    const value = preds.length === 0 ? 0 : Math.max(...preds.map(rankOf)) + 1;
    ranking.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const id of ids) {
    rankOf(id);
  }

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const layer = rank.get(id) ?? 0;
    const list = byRank.get(layer) ?? [];
    list.push(id);
    byRank.set(layer, list);
  }
  const layers = [...byRank.keys()].toSorted((a, b) => a - b);
  const nodes: DAGLayoutNode[] = [];
  for (const layer of layers) {
    const list = byRank.get(layer) ?? [];
    list.forEach((id, order) => {
      if (direction === "vertical") {
        nodes.push({
          id,
          x: padding + order * (nodeWidth + nodeGap),
          y: padding + layer * (nodeHeight + rankGap),
          rank: layer,
          order,
        });
      } else {
        nodes.push({
          id,
          x: padding + layer * (nodeWidth + rankGap),
          y: padding + order * (nodeHeight + nodeGap),
          rank: layer,
          order,
        });
      }
    });
  }

  const placed = new Map(nodes.map((node) => [node.id, node]));
  const edges: DAGLayoutEdge[] = rawEdges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) {
      return [];
    }
    if (direction === "vertical") {
      return [
        {
          from: edge.from,
          to: edge.to,
          isBackEdge: back.has(edgeKey(edge.from, edge.to)),
          sourceX: from.x + nodeWidth / 2,
          sourceY: from.y + nodeHeight,
          targetX: to.x + nodeWidth / 2,
          targetY: to.y,
        },
      ];
    }
    return [
      {
        from: edge.from,
        to: edge.to,
        isBackEdge: back.has(edgeKey(edge.from, edge.to)),
        sourceX: from.x + nodeWidth,
        sourceY: from.y + nodeHeight / 2,
        targetX: to.x,
        targetY: to.y + nodeHeight / 2,
      },
    ];
  });

  const ranks: DAGLayoutRank[] = layers.map((layer) => {
    const group = nodes.filter((node) => node.rank === layer);
    const x = Math.min(...group.map((node) => node.x));
    const y = Math.min(...group.map((node) => node.y));
    const right = Math.max(...group.map((node) => node.x + nodeWidth));
    const bottom = Math.max(...group.map((node) => node.y + nodeHeight));
    return {
      rank: layer,
      x,
      y,
      width: right - x,
      height: bottom - y,
      nodeIds: group.map((node) => node.id),
    };
  });

  const width = (nodes.length ? Math.max(...nodes.map((node) => node.x + nodeWidth)) : padding) + padding;
  const height = (nodes.length ? Math.max(...nodes.map((node) => node.y + nodeHeight)) : padding) + padding;
  return { nodes, edges, ranks, direction, width, height };
}
