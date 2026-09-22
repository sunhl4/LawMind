/**
 * Memory-source row shape — renderer-safe (no node:fs / node:crypto).
 * Disk listing stays in memory-sources.ts (server/engine only).
 */

export type MemorySourceLayer = {
  /** 稳定 ID，供 UI */
  id: string;
  /** 展示名 */
  label: string;
  /** 相对 workspace 根的路径 */
  relativePath: string;
  exists: boolean;
  charCount: number;
  /** 是否进入当前 Agent 主对话 system prompt（与架构文档一致：MEMORY 等为检索侧） */
  inAgentSystemPrompt: boolean;
  /** 补充说明 */
  hint?: string;
  /**
   * 与 `loadMemoryContext` 选中的**客户画像**源一致时置 true（同一份内容进入主对话提示与 RAG/检索管线）。
   * 非客户行通常为 false/未设置。
   */
  activeForEngine?: boolean;
};
