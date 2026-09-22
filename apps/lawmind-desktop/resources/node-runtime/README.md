# Bundled Node runtime (packaged app only)

`pnpm lawmind:desktop` uses the Node.js already on `PATH` (22+). This directory is filled only when building an installer:

```bash
pnpm lawmind:vendor:desktop-node
# or, as part of:
pnpm lawmind:desktop:dist
```

Layout after vendoring (gitignored per platform):

```
resources/node-runtime/<platform-arch>/bin/node      # macOS / Linux
resources/node-runtime/<platform-arch>/node.exe      # Windows
```

Do not commit the extracted Node tree. Clones get the same desktop by running `pnpm install` and `pnpm lawmind:desktop`; they do not need this folder until they package.
