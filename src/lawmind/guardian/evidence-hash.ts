/**
 * Stable hash of a Guardian evidence pack (Node-only).
 * Excludes `prior` so a second export of the same draft does not bust the cache.
 */

import { createHash } from "node:crypto";
import { isInfraGuardianFail } from "./legal-guardian.js";
import type { GuardianEvidencePack, GuardianRecord } from "./types.js";

export function hashGuardianEvidencePack(pack: GuardianEvidencePack): string {
  const { prior: _prior, ...rest } = pack;
  return createHash("sha256").update(JSON.stringify(rest), "utf8").digest("hex");
}

export function shouldReuseGuardianRecord(
  prior: GuardianRecord | undefined,
  packHash: string,
): boolean {
  if (!prior?.evidencePackHash || prior.evidencePackHash !== packHash) {
    return false;
  }
  if (prior.verdict === "skipped") {
    // Disabled / no_model must not cache-block a later usable model.
    // Infra skip is fail-open for this export only — next export retries,
    // matching Codex compact (failed attempt is not cached as success).
    return false;
  }
  if (isInfraGuardianFail(prior)) {
    return false;
  }
  return prior.verdict === "pass" || prior.verdict === "fail";
}
