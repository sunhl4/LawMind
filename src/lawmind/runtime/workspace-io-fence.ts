/**
 * Realpath + deny-list fence for agent file I/O that does not go through
 * `read_host_file`. Workspace-relative resolvers only check `path.resolve`,
 * so a symlink (or `.env` sitting in a mounted folder) would otherwise reach
 * the model.
 */

import os from "node:os";
import path from "node:path";
import { denyListMessage, isDeniedHostPath } from "../host-access/deny-list.js";
import { isUnderRoot, realpathOrResolve } from "../host-access/paths.js";

export type FencedAgentPath =
  | { ok: true; abs: string; rel: string }
  | { ok: false; error: string };

export function fenceAgentFilePath(params: {
  rootDir: string;
  abs: string;
  homeDir?: string;
}): FencedAgentPath {
  const root = params.rootDir.trim();
  const claimed = params.abs.trim();
  if (!root || !claimed) {
    return { ok: false, error: "路径为空。" };
  }
  const homeDir = params.homeDir ?? os.homedir();
  const realRoot = realpathOrResolve(root);
  const real = realpathOrResolve(claimed);
  if (isDeniedHostPath(claimed, { homeDir }) || isDeniedHostPath(real, { homeDir })) {
    return { ok: false, error: denyListMessage() };
  }
  if (!isUnderRoot(realRoot, real)) {
    return { ok: false, error: "不允许越过工作区或本机文件夹读取。" };
  }
  return { ok: true, abs: real, rel: path.relative(realRoot, real).replace(/\\/g, "/") };
}
