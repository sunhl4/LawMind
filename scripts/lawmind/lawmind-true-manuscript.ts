/**
 * Print true-manuscript gate status. Honest skip when fixtures are absent.
 * LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 → non-zero exit on skip (nightly/local only).
 */

import { runTrueManuscriptGateCli } from "../../src/lawmind/evaluation/true-manuscript-gate.js";

const result = await runTrueManuscriptGateCli();
process.exit(result.exitCode);
