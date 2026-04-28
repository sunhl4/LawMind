/**
 * Canonical public links for LawMind (docs site, GitHub blob URLs, jsDelivr download page).
 * Override at build time with Vite env (see `global.d.ts`).
 */

const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

export const LAWMIND_DOCS_BASE = trimTrailingSlashes(
  (env?.VITE_LAWMIND_DOCS_BASE as string | undefined) || "https://docs.lawmind.ai",
);

export const LAWMIND_GITHUB_BLOB_BASE = trimTrailingSlashes(
  (env?.VITE_LAWMIND_GITHUB_BLOB_BASE as string | undefined) ||
    "https://github.com/lawmind/lawmind/blob/main",
);

export const LAWMIND_DOWNLOAD_PAGE_URL =
  (env?.VITE_LAWMIND_DOWNLOAD_PAGE_URL as string | undefined) ||
  "https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html";

export function lawmindDocUrl(docPath: string): string {
  const p = docPath.startsWith("/") ? docPath.slice(1) : docPath;
  return `${LAWMIND_DOCS_BASE}/${p}`;
}

export function lawmindGithubBlobUrl(repoRelativePath: string): string {
  const p = repoRelativePath.startsWith("/") ? repoRelativePath.slice(1) : repoRelativePath;
  return `${LAWMIND_GITHUB_BLOB_BASE}/${p}`;
}
