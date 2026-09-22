/**
 * 文件接口失败响应的解读。
 *
 * 判定走机器可读的 `code`，不走文案：引擎改一句提示语不应该让「只读位置」这类分支
 * 失效，也不应该让 UI 的行为跟着 copy 走。
 *
 * 展示文案仍然优先用引擎原文——同一条拒写理由只在 fs-bridge / helpers 里维护一份，
 * 渲染层不复制。只有引擎漏给 error 时才用兜底句。
 */

/** 与 fs-bridge.mjs / lawmind-server-helpers.ts 的常量一致。 */
export type FsWriteFailureCode = "root_not_writable" | "protected_workspace_path";

export type FsWriteFailure = {
  ok?: boolean;
  conflict?: boolean;
  code?: string;
  error?: string;
};

export type FsWriteFailureKind = "conflict" | FsWriteFailureCode | "unknown";

export function fsWriteFailureKind(res: FsWriteFailure | undefined): FsWriteFailureKind {
  if (res?.conflict) {
    return "conflict";
  }
  if (res?.code === "root_not_writable" || res?.code === "protected_workspace_path") {
    return res.code;
  }
  return "unknown";
}

export function describeFsWriteFailure(res: FsWriteFailure | undefined): string {
  const kind = fsWriteFailureKind(res);
  if (kind === "conflict") {
    return "文件已被外部修改，请重新打开后合并。";
  }
  if (kind === "root_not_writable") {
    return res?.error ?? "该位置是只读的（已选本机文件夹不能改写）。";
  }
  if (kind === "protected_workspace_path") {
    return res?.error ?? "该路径属于 LawMind 治理数据，请改用对应的设置入口。";
  }
  return res?.error ?? "保存失败";
}
