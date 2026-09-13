# Bundled OfficeCLI

LawMind vendors the [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) binary here so Word tracked-change export and `run_host_command officecli` work without a separate install.

Layout after `pnpm lawmind:vendor:officecli` (gitignored per platform):

```
resources/officecli/<platform-arch>/officecli[.exe]
resources/officecli/<platform-arch>/LICENSE
resources/officecli/<platform-arch>/NOTICE
resources/officecli/<platform-arch>/VERSION
```

`<platform-arch>` matches Node (`darwin-arm64`, `darwin-x64`, `linux-x64`, `win32-x64`, …).

electron-builder copies this directory to `Resources/officecli/`. Attribution files live in [`third_party/officecli`](../../../../third_party/officecli/).
