import { describe, expect, it } from "vitest";
import { legalVerifyMiddleware } from "../runtime/legal-verify-middleware.js";
import {
  approvalMiddleware,
  buildDefaultToolPipeline,
  permissionModeMiddleware,
  roleAllowlistMiddleware,
} from "../runtime/tool-pipeline.js";
import {
  resolveApprovalArbitration,
  type ApprovalArbitrationInput,
} from "./approval-arbitration.js";

function decide(partial: Partial<ApprovalArbitrationInput>) {
  return resolveApprovalArbitration({
    denied: false,
    blocked: false,
    askFirst: false,
    allowAutomatically: false,
    ...partial,
  });
}

describe("approval-arbitration", () => {
  it("Ask first 赢过 Allow automatically", () => {
    expect(decide({ askFirst: true, allowAutomatically: true })).toBe("ask");
  });

  it("Deny 与 block 优先于 Ask / Allow", () => {
    expect(decide({ denied: true, askFirst: true, allowAutomatically: true })).toBe("deny");
    expect(decide({ blocked: true, askFirst: true, allowAutomatically: true })).toBe("block");
  });

  it("只有 Allow 且无其它停止理由才放行", () => {
    expect(decide({ allowAutomatically: true })).toBe("allow");
  });

  it("两边都没说时默认 ask（不可默默外发）", () => {
    expect(decide({})).toBe("ask");
  });

  it("默认管线：deny/block 中间件在审批中间件之前", () => {
    const pipe = buildDefaultToolPipeline();
    const idx = (fn: (typeof pipe)[number]) => pipe.indexOf(fn);
    expect(idx(permissionModeMiddleware)).toBeGreaterThanOrEqual(0);
    expect(idx(roleAllowlistMiddleware)).toBeGreaterThan(idx(permissionModeMiddleware));
    expect(idx(legalVerifyMiddleware)).toBeGreaterThan(idx(roleAllowlistMiddleware));
    expect(idx(approvalMiddleware)).toBeGreaterThan(idx(legalVerifyMiddleware));
  });
});
