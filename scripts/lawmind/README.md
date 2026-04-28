# LawMind CLI & ops scripts

Executable entrypoints for `pnpm lawmind:*` live here. **Hooks** and shared helpers stay in `scripts/pre-commit/`.

- `.ts` files are run with `node --import tsx …` (see root `package.json`).
- `.mjs` files are plain Node ESM.
- `lawmind-backup.sh` — optional workspace tarball; set `LAWMIND_WORKSPACE_DIR`.

The bundled desktop server imports `lawmind-env-loader.ts` via a repo-relative path from `apps/lawmind-desktop/server/`.
