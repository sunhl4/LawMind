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

/** 习惯正文以记忆库为准。档案第八节不再作为第二套习惯进入提示词。 */
export function profileWithoutAccumulation(profile: string | undefined | null): string {
  const text = profile ?? "";
  const idx = text.search(/##\s*八[、.．]?\s*个人积累/);
  if (idx < 0) {
    return text;
  }
  return text.slice(0, idx).trim();
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

const SECTION_EIGHT_HEADING_RE = /^##\s*八[、.．]?\s*个人积累/m;

/**
 * 本轮问句的重叠词：拉丁词（2–12 字）加中文双字。
 * 不用向量。档案只有百来条，哈希嵌入不是语义模型；双字重叠和知识库 FTS 同一路。
 */
function queryOverlapTerms(query: string): string[] {
  const cleaned = query
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return [];
  }
  const terms = new Set<string>();
  for (const part of cleaned.split(" ")) {
    if (part.length >= 2 && part.length <= 12) {
      terms.add(part.toLowerCase());
    }
  }
  const cjk = cleaned.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1 && terms.size < 32; i += 1) {
    terms.add(cjk.slice(i, i + 2));
  }
  return [...terms];
}

function bulletOverlapScore(bullet: string, terms: readonly string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const hay = bullet.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (hay.includes(term)) {
      score += term.length >= 3 ? 2 : 1;
    }
  }
  return score;
}

/**
 * 指纹窗：留身份字段。装不下全部积累时，有本轮问句就先留重叠高的整条，
 * 问句对不上任何一条时退回最近的整条。不用向量，也不加大 800 字预算。
 */
export function windowLawyerProfileForPrompt(
  profile: string | undefined | null,
  maxChars: number,
  query?: string,
): string {
  const text = (profile ?? "").trim();
  if (!text || text.length <= maxChars) {
    return text;
  }
  const headingMatch = SECTION_EIGHT_HEADING_RE.exec(text);
  const head = headingMatch ? text.slice(0, headingMatch.index).trim() : "";
  const section = headingMatch ? text.slice(headingMatch.index) : text;
  const sectionLines = section.split("\n");
  const heading = headingMatch ? (sectionLines[0] ?? "").trim() : "";
  const bullets = sectionLines
    .slice(heading ? 1 : 0)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const body = /^[-*]\s+(.+)$/.exec(line.trim())?.[1];
      return Boolean(body) && !isStockLawyerProfileBullet(body ?? "");
    });
  const identity = head
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("_")) {
        return false;
      }
      if (trimmed.startsWith("#")) {
        return true;
      }
      if (/[_＿]{2,}/.test(trimmed) || /[：:]\s*$/.test(trimmed)) {
        return false;
      }
      return /^\s*-\s+\*\*(姓名|称呼|所在机构|主要业务领域)\*\*/.test(trimmed);
    });

  const marker = "\n\n…[更早的个人积累已省略，完整内容见 LAWYER_PROFILE.md]\n\n";
  const prefixParts = [...identity, ...(heading ? [heading] : [])];
  let prefix = prefixParts.join("\n").trim();
  const roomForPrefix = Math.max(0, maxChars - marker.length - 24);
  if (prefix.length > roomForPrefix) {
    prefix = prefix.slice(0, roomForPrefix).trimEnd();
  }
  const terms = queryOverlapTerms(query ?? "");
  const scored = bullets.map((bullet, index) => ({
    bullet,
    index,
    score: bulletOverlapScore(bullet, terms),
  }));
  const best = scored.reduce((max, row) => Math.max(max, row.score), 0);
  const ranked =
    best > 0
      ? scored.toSorted((a, b) => b.score - a.score || b.index - a.index)
      : scored.toSorted((a, b) => b.index - a.index);
  const picked: Array<{ bullet: string; index: number }> = [];
  let used = prefix.length + (bullets.length > 0 ? marker.length : 0);
  for (const row of ranked) {
    if (best > 0 && row.score <= 0) {
      break;
    }
    const next = used + row.bullet.length + 1;
    if (picked.length > 0 && next > maxChars) {
      continue;
    }
    if (picked.length === 0 && prefix.length + row.bullet.length + 1 > maxChars) {
      break;
    }
    picked.push(row);
    used = next;
  }
  picked.sort((a, b) => a.index - b.index);
  const omitted = bullets.length - picked.length;
  const omitNote =
    omitted > 0
      ? best > 0
        ? `…[另有 ${omitted} 条与本轮问题关系较弱，已省略，完整内容见 LAWYER_PROFILE.md]`
        : `…[更早 ${omitted} 条个人积累已省略，完整内容见 LAWYER_PROFILE.md]`
      : "";
  const body = [prefix, omitNote, ...picked.map((row) => row.bullet)].filter(Boolean).join("\n");
  return body.length <= maxChars ? body : body.slice(0, maxChars);
}
