# LawMind CLI & ops scripts

Executable entrypoints for `pnpm lawmind:*` live here. **Hooks** and shared helpers stay in `scripts/pre-commit/`.

- `lawmindd.ts` — `pnpm lawmind:daemon`：独立本机 HTTP（默认 `127.0.0.1:4312`），与桌面同一套 API，供 Word/WPS 侧车。
- `.ts` files are run with `node --import tsx …` (see root `package.json`).
- `.mjs` files are plain Node ESM.
- `lawmind-backup.sh` — optional workspace tarball; set `LAWMIND_WORKSPACE_DIR`.

The bundled desktop server imports `lawmind-env-loader.ts` via a repo-relative path from `apps/lawmind-desktop/server/`.
