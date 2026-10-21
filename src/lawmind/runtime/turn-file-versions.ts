/**
 * 回合内文件版本账本：同一回合里对同一路径的第二次写入，必须基于第一次的版本。
 *
 * 为什么需要：
 *   模型写文件是「读 → 改 → 写」。律师在 Finder / Word 里同时改同一份原件时，
 *   后写的一方会静默覆盖先写的一方。这里在**第一次触碰**该路径时记下版本，
 *   之后每次写入前比对；版本变了就拒绝并回报当前版本，让律师/模型改副本。
 *
 * 边界：账本随回合结束丢弃，不做跨回合冲突检测（那是文件页/同步层的职责）。
 */

import { inspectFileVersion } from "./file-version-state.js";
import { fileVersionOf } from "./file-version.js";

export type TurnFileVersionLedger = Record<string, string>;

type CtxWithLedger = {
  /** 回合级账本；由工具在首次触碰时惰性创建。 */
  turnFileVersions?: TurnFileVersionLedger;
};

export type VersionCheck =
  | { ok: true; expectedVersion?: string }
  | { ok: false; error: string; currentVersion: string };

function ledgerOf(ctx: CtxWithLedger): TurnFileVersionLedger {
  if (!ctx.turnFileVersions) {
    ctx.turnFileVersions = {};
  }
  return ctx.turnFileVersions;
}

/**
 * 写入/搬移前调用：
 *   - 首次触碰已有文件：记下当前版本作为基线，放行；
 *   - 已有基线且磁盘版本不同：拒绝（外部改动）；
 *   - 文件不存在：放行（新建）。
 */
export function checkTurnFileVersion(ctx: CtxWithLedger, rel: string, abs: string): VersionCheck {
  const ledger = ledgerOf(ctx);
  const inspected = inspectFileVersion(abs);
  if (inspected.state === "unverifiable") {
    return {
      ok: false,
      error: `「${rel}」无法核对当前版本，本次没有覆盖。`,
      currentVersion: "unknown",
    };
  }
  const current = inspected.version;
  const expected = Object.hasOwn(ledger, rel) ? ledger[rel] : undefined;
  if (expected === undefined) {
    ledger[rel] = current;
    return { ok: true, expectedVersion: current };
  }
  if (expected !== current) {
    return {
      ok: false,
      currentVersion: current,
      error:
        `「${rel}」在本次办理开始后已被改动（可能是您在 Word / 访达里改过）。` +
        "为避免覆盖您的修改，这次没有写回。请让我改副本，或确认以当前磁盘版本为准后再写。",
    };
  }
  return { ok: true, expectedVersion: current };
}

export function rememberWrittenFileVersion(ctx: CtxWithLedger, rel: string, version: string): void {
  ledgerOf(ctx)[rel] = version;
}

/** 写入成功后更新基线，供同一回合的后续写入比对。 */
export function recordTurnFileVersion(
  ctx: CtxWithLedger,
  rel: string,
  abs: string,
): string | undefined {
  const version = fileVersionOf(abs);
  if (version !== undefined) {
    ledgerOf(ctx)[rel] = version;
  }
  return version;
}
