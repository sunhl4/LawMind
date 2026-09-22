/**
 * Paths that may host run_analysis guest scripts.
 * write_document must not plant files here — only signed skills or lawyer-dropped scripts.
 */

export function normalizeWorkspaceRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/** Any file under the two script roots (including .mjs / notes). */
export function isProtectedAnalysisScriptRel(rel: string): boolean {
  const n = normalizeWorkspaceRel(rel);
  if (n.startsWith("artifacts/analysis-scripts/")) {
    return n.length > "artifacts/analysis-scripts/".length;
  }
  if (n.startsWith("lawmind/skills/") && /\/scripts\//.test(n)) {
    return true;
  }
  return false;
}

export function parseSkillAnalysisScriptRel(
  rel: string,
): { skillId: string; file: string } | undefined {
  const n = normalizeWorkspaceRel(rel);
  const m = /^lawmind\/skills\/([^/]+)\/scripts\/([^/]+)\.js$/.exec(n);
  if (!m?.[1] || !m[2]) {
    return undefined;
  }
  return { skillId: m[1], file: m[2] };
}

export function isAllowedAnalysisScriptRel(rel: string): boolean {
  const n = normalizeWorkspaceRel(rel);
  if (parseSkillAnalysisScriptRel(n)) {
    return true;
  }
  return /^artifacts\/analysis-scripts\/[^/]+\.js$/.test(n);
}
