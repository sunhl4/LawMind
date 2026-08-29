/**
 * Surface recent lawyer preference bullets so UI and prompts can say
 * "已按你的习惯" instead of silently stuffing a long profile.
 */

const SECTION_EIGHT_RE = /^##\s*八[、.．]?\s*个人积累/m;
const NEXT_SECTION_RE = /^##\s+/m;

export type AppliedPreference = {
  text: string;
  /** ISO date if the bullet embeds a date prefix, else undefined */
  capturedAt?: string;
};

/**
 * Extract recent bullets from LAWYER_PROFILE.md section「八、个人积累」.
 * Newest bullets are typically appended at the end of the section.
 */
export function extractAppliedPreferencesFromProfile(
  profileMarkdown: string,
  limit = 5,
): AppliedPreference[] {
  if (!profileMarkdown.trim() || limit <= 0) {
    return [];
  }
  const start = profileMarkdown.search(SECTION_EIGHT_RE);
  if (start < 0) {
    return [];
  }
  const afterHeader = profileMarkdown.slice(start).split("\n").slice(1).join("\n");
  const next = afterHeader.search(NEXT_SECTION_RE);
  const body = (next >= 0 ? afterHeader.slice(0, next) : afterHeader).trim();
  const bullets: AppliedPreference[] = [];
  for (const line of body.split("\n")) {
    const m = /^[-*]\s+(.+)$/.exec(line.trim());
    if (!m) {
      continue;
    }
    const text = m[1].trim();
    if (!text || text.length < 4) {
      continue;
    }
    const dateMatch = /^(\d{4}-\d{2}-\d{2})\s*[：:]\s*(.+)$/.exec(text);
    if (dateMatch) {
      bullets.push({ text: dateMatch[2].trim(), capturedAt: dateMatch[1] });
    } else {
      bullets.push({ text });
    }
  }
  return bullets.slice(-limit).toReversed();
}

/** One-line hint for assignment cards / system prompt. */
export function formatAppliedPreferencesHint(prefs: AppliedPreference[]): string | undefined {
  if (prefs.length === 0) {
    return undefined;
  }
  const lines = prefs.map((p) => `· ${p.text}`).slice(0, 5);
  return ["已按你的习惯（来自过往审核与偏好沉淀）：", ...lines].join("\n");
}
