# LawMind repository patterns

**Reuse existing code; avoid parallel helpers.**

## Tech stack

- **Runtime**: Node 22+
- **Language**: TypeScript (ESM)
- **Package manager**: pnpm
- **Lint / format**: Oxlint, Oxfmt
- **Tests**: Vitest

## Layout

- Legal engine: `src/lawmind/`
- Desktop shell: `apps/lawmind-desktop/`
- Docs site: `apps/lawmind-docs/`

## Conventions

- Prefer `.js` extensions in relative imports (ESM).
- Colocate tests as `*.test.ts` near sources.
- Match naming and style of surrounding files.

## Commands

- `pnpm install`
- `pnpm test`
- `pnpm lawmind:desktop` — Electron dev shell
- `pnpm lawmind:docs:dev` — VitePress docs

If pairing with a human, use git directly and run tests before pushing.
