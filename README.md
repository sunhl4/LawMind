# LawMind

LawMind is a **local-first lawyer workbench**: Electron desktop (`apps/lawmind-desktop`), a bundled local HTTP API, and the legal engine in `src/lawmind`.

**Repository layout (for contributors & release):** see [docs/LAWMIND-REPO-LAYOUT.md](docs/LAWMIND-REPO-LAYOUT.md).

## Quick start

```bash
pnpm install
pnpm lawmind:desktop
```

## Common commands

| Command                                             | Purpose                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm test`                                         | Vitest — `src/lawmind` + LawMind desktop unit tests                 |
| `pnpm lawmind:bundle:desktop-server`                | Produce `apps/lawmind-desktop/server/dist/lawmind-local-server.cjs` |
| `pnpm lawmind:agent`                                | CLI agent                                                           |
| `pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build` | VitePress docs app                                                  |

## Layout (summary)

- `src/lawmind/` — engine (tasks, drafts, agent, policy, templates, …)
- `apps/lawmind-desktop/` — Electron shell + local server sources
- `apps/lawmind-docs/` — documentation site (syncs from root `docs/`)
- `docs/` — LawMind markdown **source of truth** for the docs site
- `scripts/lawmind/` — CLI & ops entrypoints (`pnpm lawmind:*`)
- `workspace/` — dev/demo workspace disk (runtime subdirs gitignored — see `workspace/README.md`)

The root package name is `lawmind`. For dev, the desktop binary accepts `LAWMIND_REPO_ROOT` pointing at this repository; `package.json` may be named `lawmind` or legacy `openclaw` for compatibility.

## License

MIT — see `LICENSE`.
