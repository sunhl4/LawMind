/** Explicit lawyer todo marks written as 【待补充：…】. */
export const EXPLICIT_TODO_PLACEHOLDER_SOURCE = "【待补充[:：][^】]*】";
export const EXPLICIT_TODO_PLACEHOLDER = /【待补充[:：][^】]*】/g;

/** Scaffold field marks such as 【出租人姓名/名称】 (no newline, ≤40 chars). */
export const SCAFFOLD_PLACEHOLDER_SOURCE = "【[^】\\n]{1,40}】";
export const SCAFFOLD_PLACEHOLDER_PATTERN = /【[^】\n]{1,40}】/g;

export const DEFAULT_PLACEHOLDER_PATTERN = EXPLICIT_TODO_PLACEHOLDER;

/**
 * keyword-draft 骨架用的短标签。只认这些，避免把【法释〔2023〕1号】一类写成未填。
 * 函件/租赁 spec 仍可用 SCAFFOLD_PLACEHOLDER_PATTERN 做字段级 mustResolve。
 */
export const SCAFFOLD_FIELD_HINTS = [
  "出租人",
  "承租人",
  "甲方",
  "乙方",
  "收函对象",
  "委托人",
  "事实经过",
  "核心主张",
  "履行期限",
  "律师事务所",
  "律师姓名",
  "发函日期",
  "房屋地址",
  "建筑面积",
  "租金",
  "押金",
  "管辖",
  "证件号码",
  "联系地址",
  "联系电话",
  "请根据任务要求补足正文内容",
  "争议事项",
  "标的描述",
  "总价款",
  "违约责任",
] as const;

const BRACKET_FIELD = /【([^】\n]{1,40})】/g;

export function isScaffoldFieldLabel(inner: string): boolean {
  const text = inner.trim();
  if (!text) {
    return false;
  }
  if (/^待补充[:：]/.test(text)) {
    return true;
  }
  return SCAFFOLD_FIELD_HINTS.some((hint) => text.includes(hint));
}

export function findScaffoldPlaceholders(text: string): string[] {
  const found: string[] = [];
  const explicit = text.match(new RegExp(EXPLICIT_TODO_PLACEHOLDER.source, "g")) ?? [];
  found.push(...explicit);
  const re = new RegExp(BRACKET_FIELD.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1] ?? "";
    if (isScaffoldFieldLabel(inner) && !found.includes(m[0])) {
      found.push(m[0]);
    }
  }
  return found;
}

export function countScaffoldPlaceholdersInDraft(
  sections: Array<{ heading: string; body: string }>,
): string[] {
  const samples: string[] = [];
  for (const section of sections) {
    samples.push(...findScaffoldPlaceholders(`${section.heading}\n${section.body}`));
  }
  return samples;
}

/** 至少 3 处骨架占位，或极短正文里连续填空 → 仍是骨架稿。单处【待补充】不当整稿骨架。 */
export function isHighScaffoldDensity(samples: string[], plainTextLength: number): boolean {
  if (samples.length >= 3) {
    return true;
  }
  return samples.length >= 2 && plainTextLength < 200;
}
