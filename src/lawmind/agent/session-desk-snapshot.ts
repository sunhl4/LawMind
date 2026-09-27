/**
 * 在办目录用的会话瘦索引。完整会话仍在 `<id>.json`。
 * 这里只丢掉对话历史，标题、回合和待拍板留着，避免打开在办时把每段对话都读进内存。
 */

import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { AgentSession } from "./types.js";

export function slimSessionForDesk(session: AgentSession): AgentSession {
  return { ...session, conversationHistory: [] };
}

export function writeSessionDeskSnapshot(workspaceDir: string, session: AgentSession): void {
  const file = path.join(workspaceDir, "sessions", `${session.sessionId}.desk.json`);
  writeJsonAtomic(file, slimSessionForDesk(session));
}
