/**
 * Build CollaborationPolicy.allowedPairs from assistant org fields.
 * Empty org graph → open graph (Solo unchanged). When any reportsTo /
 * peerReviewDefault is set, pairs become an allowlist.
 */

import type { AssistantProfile } from "../../assistants/types.js";
import { DEFAULT_COLLABORATION_POLICY, type CollaborationPolicy } from "./types.js";

function pair(fromId: string, toId: string): string {
  return `${fromId}:${toId}`;
}

/**
 * If any profile declares reportsTo or peerReviewDefault, fill allowedPairs:
 * - member → lead (and lead → member) for reporting lines
 * - both ways for peerReviewDefaultAssistantId
 * Otherwise keep today's open graph (empty allowedPairs).
 */
export function buildCollaborationPolicyFromAssistants(
  profiles: AssistantProfile[],
  base: CollaborationPolicy = DEFAULT_COLLABORATION_POLICY,
): CollaborationPolicy {
  const hasOrg = profiles.some(
    (p) =>
      Boolean(p.reportsToAssistantId?.trim()) || Boolean(p.peerReviewDefaultAssistantId?.trim()),
  );
  if (!hasOrg) {
    return { ...base, allowedPairs: [...base.allowedPairs] };
  }

  const pairs = new Set<string>(base.allowedPairs);
  for (const p of profiles) {
    const id = p.assistantId?.trim();
    if (!id) {
      continue;
    }
    const lead = p.reportsToAssistantId?.trim();
    if (lead && lead !== id) {
      pairs.add(pair(id, lead));
      pairs.add(pair(lead, id));
    }
    const peer = p.peerReviewDefaultAssistantId?.trim();
    if (peer && peer !== id) {
      pairs.add(pair(id, peer));
      pairs.add(pair(peer, id));
    }
  }
  return { ...base, allowedPairs: [...pairs] };
}
