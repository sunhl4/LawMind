/**
 * Empty LAWYER_PROFILE templates must not enter the system prompt as if they were preferences.
 * Filled identity fields or real「个人积累」bullets (dated learning, review notes) may still inject.
 */

const FILLED_FIELD_RE = /^-\s*\*\*(姓名|称呼|所在机构|主要业务领域)\*\*[：:][ \t]*(?!_|$)(\S.*)$/m;

const SECTION_EIGHT_RE = /##\s*八[、.．]?\s*个人积累[\s\S]+/m;

/** Stock instructional lines in the shipped template — not lawyer habits. */
export function isStockLawyerProfileBullet(text: string): boolean {
  const t = text.trim();
  if (!t || t.startsWith("_") || t.includes("_（例：")) {
    return true;
  }
  if (t.includes("学习队列（稍后采纳）") && t.includes("进入队列")) {
    return true;
  }
  if (t.includes("审核标签（可选）") && t.includes("用固定标签")) {
    return true;
  }
  return false;
}

function sectionEightBody(text: string): string {
  return SECTION_EIGHT_RE.exec(text)?.[0]?.trim() ?? "";
}

function hasRealAccumulation(sectionEight: string): boolean {
  if (!sectionEight) {
    return false;
  }
  if (/^[-*]\s+\[\d{4}-\d{2}-\d{2}/m.test(sectionEight)) {
    return true;
  }
  if (sectionEight.includes("草稿审核学习")) {
    return true;
  }
  for (const line of sectionEight.split("\n")) {
    const m = /^[-*]\s+(.+)$/.exec(line.trim());
    if (!m) {
      continue;
    }
    if (!isStockLawyerProfileBullet(m[1])) {
      return true;
    }
  }
  return false;
}

export function lawyerProfileForPrompt(raw: string | undefined): string | undefined {
  const text = raw?.trim() ?? "";
  if (!text) {
    return undefined;
  }
  const filled = FILLED_FIELD_RE.test(text);
  const sectionEight = sectionEightBody(text);
  const hasAccumulation = hasRealAccumulation(sectionEight);
  if (!filled && !hasAccumulation) {
    return undefined;
  }
  if (!filled && hasAccumulation) {
    return sectionEight;
  }
  return text;
}
