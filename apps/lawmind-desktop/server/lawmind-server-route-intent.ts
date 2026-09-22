/**
 * POST /api/intent/compile — same peek + compile path as runTurn (preview for status bar).
 */

import { loadSession } from "../../../src/lawmind/agent/session.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { compileTurnIntent } from "../../../src/lawmind/intent/compile-turn-intent.js";
import { intentCompileRequestSchema } from "../../../src/lawmind/platform/local-api-schemas.js";
import { parseContextPins } from "../../../src/lawmind/platform/compose-context-pin.js";
import { isLawyerCapabilityId } from "../../../src/lawmind/skills/lawyer-capability-lock.js";
import {
  isInvalidRequestBodyError,
  parseJsonBodyZod,
} from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

export async function handleIntentRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;
  const { workspaceDir } = ctx;

  if (!(pathname === "/api/intent/compile" && req.method === "POST")) {
    return false;
  }

  try {
    const body = await parseJsonBodyZod(req, intentCompileRequestSchema);
    const matterId = body.matterId?.trim() || undefined;
    if (matterId && !isValidMatterId(matterId)) {
      sendJson(res, 400, { ok: false, error: "invalid matterId" }, c);
      return true;
    }
    const previousRaw = body.previousCapabilityId?.trim();
    let previousCapabilityId =
      previousRaw && isLawyerCapabilityId(previousRaw) ? previousRaw : undefined;
    let historyText = body.historyText;
    const sessionId = body.sessionId?.trim();
    if (sessionId) {
      const session = loadSession(workspaceDir, sessionId);
      if (session) {
        if (!previousCapabilityId && session.lastBoundCapabilityId) {
          previousCapabilityId = session.lastBoundCapabilityId;
        }
        if (historyText == null || historyText === "") {
          historyText = session.conversationHistory
            .slice(-8)
            .map((m) => (typeof m.content === "string" ? m.content : ""))
            .join("\n");
        }
      }
    }
    /**
     * `compileTurnIntent` 的声明只要**已归一**的 pins（`ComposeContextPin[]`），
     * 而请求体允许两种形状：带 `pinKind` 的新形状，以及**不带 `pinKind` 的旧文件 pin**
     * （`contextPinsRequestSchema` = 新形状 ∪ 旧文件形状）。这里补上模块里本就有的归一器。
     *
     * ⚠️ **这是类型契约修复，不是已证实的用户可见缺陷。**
     * 下游（`peek-pinned-documents.ts` / `compile-intent.ts`）本来就用
     * `"relPath" in pin` 这类鸭子类型判断，**对旧形状也容得下**——所以行为面很可能一直是对的。
     * 唯一可能的语义差异是 `peekPinnedDocuments` 的 `preferredRoot`（旧形状取不到 root），
     * 且仅在「同一相对路径在 workspace 与 project 下同时存在」时才会显现。
     * 归一失败改 400（原来是形状不对也照传）。回归锁见
     * `lawmind-server-route-intent.test.ts`（含上述边界说明）。
     */
    const pins = parseContextPins(body.contextPins);
    if (!Array.isArray(pins)) {
      sendJson(res, 400, { ok: false, error: pins.error }, c);
      return true;
    }
    const compiled = await compileTurnIntent({
      workspaceDir,
      projectDir: body.projectDir?.trim() || undefined,
      instruction: body.instruction ?? "",
      pins,
      matterId,
      previousCapabilityId,
      historyText,
      mailFastPath: body.mailFastPath,
    });
    sendJson(res, 200, { ok: true, compiled }, c);
  } catch (err) {
    if (isInvalidRequestBodyError(err)) {
      sendJson(res, 400, { ok: false, error: "invalid body", issues: err.issues }, c);
      return true;
    }
    throw err;
  }
  return true;
}
