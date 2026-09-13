# OfficeCLI (bundled with LawMind)

LawMind vendors the [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) native binary so Word 修订轨 / 改稿 does not require lawyers or clone-from-GitHub users to install a separate CLI.

- Upstream: https://github.com/iOfficeAI/OfficeCLI
- License: Apache-2.0 (`LICENSE` + `NOTICE` in this directory; copied next to the vendored binary)
- Pin / download: `scripts/vendor-officecli.mjs` (GitHub Releases, SHA256SUMS)
- Runtime layout: `apps/lawmind-desktop/resources/officecli/<platform-arch>/`

Do not commit the ~32MB binary. `pnpm install` (non-CI) and `pnpm lawmind:desktop:dist` fetch the current OS/arch build.
