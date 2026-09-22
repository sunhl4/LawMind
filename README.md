# LawMind

LawMind is a **local-first lawyer workbench**: Electron desktop (`apps/lawmind-desktop`), a bundled local HTTP API, and the legal engine in `src/lawmind`.

**Repository layout (for contributors & release):** see [docs/LAWMIND-REPO-LAYOUT.md](docs/LAWMIND-REPO-LAYOUT.md).

## Quick start

Clone from GitHub, then install **on the same OS/arch** you will run. That yields the same LawMind desktop as developing on this machine (`pnpm lawmind:desktop` → Electron window). API keys and matter files stay local; they are not in the repo.

**Prerequisites:** [Node.js](https://nodejs.org/) **22.16+** (see `.nvmrc`) and **pnpm 10.23.0**.

```bash
git clone https://github.com/sunhl4/LawMind.git
cd LawMind
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install
pnpm lawmind:desktop
```

Open the **LawMind** window that Electron launches. Do **not** use a browser tab or `http://127.0.0.1:5174` as the product UI.

`pnpm install` downloads OfficeCLI for the current OS (Word tracked changes / 改稿, Apache-2.0) and stamps the dev Electron app name/icon. CI skips that download; `pnpm lawmind:desktop:dist` vendors Node + OfficeCLI into the installer. If pnpm v10 skipped Electron’s `postinstall`, run `pnpm approve-builds` (allow `electron`), then `pnpm install` again.

First-run: complete the in-app model wizard, or copy `.env.lawmind.example` into the LawMind user-data `.env.lawmind` (never commit real keys).

**Packaged client** (same UI as `LawMind.app` / installer, with bundled Node):

```bash
pnpm lawmind:desktop:dist
```

GitHub Release installers: [sunhl4/LawMind/releases](https://github.com/sunhl4/LawMind/releases) (workflow **LawMind desktop build**, tag `lawmind-desktop-v*`). Current packaged line is **0.2.1**.

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

MIT — see `LICENSE`. Bundled OfficeCLI is Apache-2.0; notices live in `third_party/officecli/`.
