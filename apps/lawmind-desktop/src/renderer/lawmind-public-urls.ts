/**
 * Canonical public links for LawMind (product docs site + download).
 * Production defaults pin to docs.lawmind.ai. Override at build time with Vite env
 * (see `global.d.ts`) or Electron `LAWMIND_DOWNLOAD_PAGE_URL`.
 */

const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

/** Product site + handbook (VitePress). */
export const LAWMIND_DOCS_BASE = trimTrailingSlashes(
  (env?.VITE_LAWMIND_DOCS_BASE as string | undefined) || "https://docs.lawmind.ai",
);

export const LAWMIND_GITHUB_BLOB_BASE = trimTrailingSlashes(
  (env?.VITE_LAWMIND_GITHUB_BLOB_BASE as string | undefined) ||
    "https://github.com/lawmind/lawmind/blob/main",
);

/**
 * Smart download landing (same page shipped under docs site `/download/` and
 * `apps/lawmind-desktop/download/index.html`). Prefer the product domain in production.
 */
export const LAWMIND_DOWNLOAD_PAGE_URL =
  (env?.VITE_LAWMIND_DOWNLOAD_PAGE_URL as string | undefined) ||
  `${LAWMIND_DOCS_BASE}/download/`;

export function lawmindDocUrl(docPath: string): string {
  const p = docPath.startsWith("/") ? docPath.slice(1) : docPath;
  return `${LAWMIND_DOCS_BASE}/${p}`;
}

export function lawmindGithubBlobUrl(repoRelativePath: string): string {
  const p = repoRelativePath.startsWith("/") ? repoRelativePath.slice(1) : repoRelativePath;
  return `${LAWMIND_GITHUB_BLOB_BASE}/${p}`;
}
