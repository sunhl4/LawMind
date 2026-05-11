/**
 * EngineContext — engine 子模块共享的上下文。
 *
 * 把原 `src/lawmind/index.ts` 闭包里的 `workspaceDir / outputDir / auditDir / adapters / assistantId`
 * 抽出为显式参数，便于把 `plan / research / draft / review / render` 拆到各自文件里独立测试。
 */

import path from "node:path";
import type { RetrievalAdapter } from "../retrieval/index.js";
import type { LawMindEngineConfig } from "./types.js";

export type EngineContext = {
  workspaceDir: string;
  outputDir: string;
  auditDir: string;
  adapters: RetrievalAdapter[];
  assistantId?: string;
};

export function buildEngineContext(config: LawMindEngineConfig): EngineContext {
  const workspaceDir = config.workspaceDir;
  const outputDir = config.outputDir ?? path.join(workspaceDir, "artifacts");
  const auditDir = path.join(workspaceDir, "audit");
  return {
    workspaceDir,
    outputDir,
    auditDir,
    adapters: config.adapters,
    assistantId: config.assistantId,
  };
}
