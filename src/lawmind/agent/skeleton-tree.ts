/**
 * Outline forest for the draft skeleton. Headings are a starting point the
 * model may change, not a sentence script. Not a lawyer-facing template picker.
 */

export type SkeletonNode = {
  heading: string;
  children: SkeletonNode[];
};

const OUTLINE_PREFIX = /^(\d{1,2}(?:\.\d{1,2}){0,3})(?:[ \t　]|$)/;

export function outlineDepth(heading: string): number {
  const numbered = OUTLINE_PREFIX.exec(heading.trim());
  if (!numbered?.[1]) {
    return 1;
  }
  return numbered[1].split(".").length;
}

export function parseSkeletonForest(headings: readonly string[]): SkeletonNode[] {
  const root: SkeletonNode[] = [];
  const stack: Array<{ depth: number; node: SkeletonNode }> = [];
  for (const raw of headings) {
    const heading = raw.trim();
    if (!heading) {
      continue;
    }
    const depth = outlineDepth(heading);
    const node: SkeletonNode = { heading, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.node.children.push(node);
    } else {
      root.push(node);
    }
    stack.push({ depth, node });
  }
  return root;
}

export function flattenSkeleton(nodes: readonly SkeletonNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly SkeletonNode[]): void => {
    for (const node of list) {
      out.push(node.heading);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function cloneSkeleton(nodes: readonly SkeletonNode[]): SkeletonNode[] {
  return nodes.map((node) => ({
    heading: node.heading,
    children: cloneSkeleton(node.children),
  }));
}

/** Build a forest from outline levels. Level 1 is a root. Deeper levels nest. */
export function skeletonFromLevels(
  rows: readonly { level: number; text: string }[],
): SkeletonNode[] {
  const root: SkeletonNode[] = [];
  const stack: Array<{ level: number; node: SkeletonNode }> = [];
  for (const row of rows) {
    const heading = row.text.trim();
    if (!heading) {
      continue;
    }
    const level = Math.min(6, Math.max(1, Math.floor(row.level) || 1));
    const node: SkeletonNode = { heading, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.node.children.push(node);
    } else {
      root.push(node);
    }
    stack.push({ level, node });
  }
  return root;
}

export function skeletonHasHeading(nodes: readonly SkeletonNode[], heading: string): boolean {
  const want = heading.trim();
  if (!want) {
    return false;
  }
  for (const node of nodes) {
    if (node.heading === want || skeletonHasHeading(node.children, want)) {
      return true;
    }
  }
  return false;
}
