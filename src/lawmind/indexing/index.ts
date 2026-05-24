export {
  SEARCH_INDEX_SCHEMA_VERSION,
  lawmindDir,
  searchIndexPath,
} from "./workspace-index-path.js";
export {
  rebuildWorkspaceSearchIndex,
  openSearchIndexDb,
  indexExists,
  type RebuildIndexResult,
  type RebuildIndexOptions,
} from "./fts-ingest.js";
export {
  searchWorkspaceIndex,
  getSearchIndexStatus,
  type WorkspaceSearchHit,
  type WorkspaceSearchOptions,
  type WorkspaceSearchResult,
  type SearchIndexSource,
} from "./fts-search.js";
