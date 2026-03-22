# Bundled Node.js runtime (LawMind desktop)

This directory is populated at **packaging time**, not committed to git.

## Layout after `pnpm lawmind:vendor:desktop-node`

Electron copies the subtree into `resources/node-runtime/` inside the app bundle. The main process looks for:

| Build machine    | Subdirectory   | Node binary                         |
|-----------------|----------------|-------------------------------------|
| macOS arm64     | `darwin-arm64` | `bin/node`                          |
| macOS x64       | `darwin-x64`   | `bin/node`                          |
| Windows x64     | `win32-x64`    | `node.exe` (and shipped DLLs)       |
| Linux x64       | `linux-x64`    | `bin/node`                          |

`electron-builder` runs on one OS per build, so only one subdirectory exists in each artifact.

## Commands

From repo root:

```bash
pnpm lawmind:vendor:desktop-node
```

Then from `apps/lawmind-desktop` (or via `pnpm run dist:electron`, which vendors Node automatically):

```bash
pnpm run dist:electron
```

Override Node version:

```bash
LAWMIND_DESKTOP_NODE_VERSION=22.14.0 pnpm lawmind:vendor:desktop-node
```

End users can still override the binary with env `LAWMIND_NODE_BIN` (advanced).
