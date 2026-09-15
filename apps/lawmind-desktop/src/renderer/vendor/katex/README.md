# KaTeX (bundled)

LawMind chat uses [KaTeX](https://github.com/KaTeX/KaTeX) (MIT) — the same math engine Codex App / VS Code Markdown preview use (`remark-math` + `rehype-katex`, or `@vscode/markdown-it-katex`).

This is **not** a VS Code Marketplace extension. The npm package is locked in `apps/lawmind-desktop/package.json`; Vite folds JS, CSS, and fonts into the Electron renderer. Clone + `pnpm install`, or install a LawMind release: no extra plugin or CDN setup.

- Upstream: https://github.com/KaTeX/KaTeX
- License: `LICENSE` in this directory
- Runtime import: `katex` + `katex/dist/katex.min.css` from `apps/lawmind-desktop`
