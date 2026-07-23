import path from "node:path";

/** Bumped when knowledge_fts (personal KB) corpus was added. */
export const SEARCH_INDEX_SCHEMA_VERSION = 2;

export function lawmindDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind");
}

export function searchIndexPath(workspaceDir: string): string {
  return path.join(lawmindDir(workspaceDir), "search-index.sqlite");
}
