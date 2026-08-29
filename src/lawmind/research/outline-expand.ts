/**
 * Expand an approved research outline into draft ArtifactSections.
 */

import type { ArtifactSection, ResearchBundle, ResearchClaim } from "../types.js";
import type { ResearchOutline } from "./research-outline.js";

function claimMatchesSection(claim: ResearchClaim, heading: string, bullets: string[]): boolean {
  const hay = `${heading} ${bullets.join(" ")}`.toLowerCase();
  const tokens = claim.text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) {
    return false;
  }
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) {
      hits += 1;
    }
  }
  return hits >= Math.min(2, tokens.length);
}

/** Expand an approved outline into body sections; prefer outline bullets over FIFO claim dump. */
export function expandApprovedOutlineToSections(
  outline: ResearchOutline,
  bundle: ResearchBundle,
): ArtifactSection[] {
  const unused = [...bundle.claims];
  const sections: ArtifactSection[] = outline.sections.map((s) => {
    const bulletBody = s.bullets.map((b) => `- ${b}`).join("\n") || "【待补充：本章节要点】";
    const matched: ResearchClaim[] = [];
    for (let i = unused.length - 1; i >= 0; i -= 1) {
      const c = unused[i];
      if (claimMatchesSection(c, s.heading, s.bullets)) {
        matched.unshift(c);
        unused.splice(i, 1);
        if (matched.length >= 2) {
          break;
        }
      }
    }
    const claimBody =
      matched.length > 0
        ? `\n\n检索要点：\n${matched
            .map(
              (c, i) =>
                `${i + 1}. ${c.text}${c.sourceIds.length ? ` 〔${c.sourceIds.join(",")}〕` : ""}`,
            )
            .join("\n\n")}`
        : "";
    return {
      heading: s.heading,
      body: `${bulletBody}${claimBody}`,
      citations: matched.flatMap((c) => c.sourceIds),
    };
  });

  if (unused.length > 0) {
    sections.push({
      heading: "未归类检索要点",
      body: unused
        .slice(0, 8)
        .map(
          (c, i) =>
            `${i + 1}. ${c.text}${c.sourceIds.length ? ` 〔${c.sourceIds.join(",")}〕` : ""}`,
        )
        .join("\n\n"),
      citations: unused.slice(0, 8).flatMap((c) => c.sourceIds),
    });
  }

  return sections;
}
