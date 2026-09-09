# Vision (LawMind)

LawMind is the **lawyer-facing integration and delivery layer for the agent ecosystem**. It continuously discovers capable legal Skills, plugins, MCP servers, tools, prompts, and workflows built for Cursor, Codex, Claude Code, and compatible agents; verifies what actually works; then digests the useful parts into one coherent LawMind experience.

LawMind does not assume that the best legal capability must be invented inside this repository. Its advantage comes from finding broadly, evaluating honestly, adapting quickly, and combining proven capabilities around lawyers' real daily work.

**Four non-negotiables**: (1) **easy to start**, (2) **high deliverable quality**, (3) **stable, predictable delivery**, and (4) **reuse before reinvention**. The Chinese source of truth is `GOALS.md` §二.

Auditability is not a product goal or a proxy for legal quality. Logs, provenance, approvals, and security controls may exist where they solve a concrete operational, diagnostic, safety, or regulatory problem, but LawMind must not market their existence as proof that work is correct, trustworthy, or useful.

Product principles live in **`GOALS.md`**; historical narrative and phases are snapshots in `docs/archive/`. Architecture and runtime shape: **`docs/LAWMIND-ARCHITECTURE.md`**.

## Engineering norms (short)

- One PR ≈ one issue or coherent topic; avoid unrelated drive-by edits.
- Prefer evidence: failing test, logs, or traced code path for bugfixes.
- See **`AGENTS.md`** for layout, commands, and tooling.

## Goals checklist

Living roadmap and checked milestones: **`GOALS.md`**.
