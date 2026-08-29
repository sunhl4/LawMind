# 在办 Desk V2 — mockup assets

Design truth: [`docs/LAWMIND-DESKTOP-UI.md`](../../LAWMIND-DESKTOP-UI.md)

| File | Meaning |
|------|---------|
| `00-compare.png` | Side-by-side: current pain vs Decision Inbox |
| `01-current-pain.png` | Annotated current layout problems |
| `02-inbox-focus.png` | Target: segments + Focus Stage |

Regenerate (default **3×**, ~4320×2700 per frame):

```bash
pnpm lawmind:ui:agents-desk-mockups
```

Smaller files (2×):

```bash
LAWMIND_UI_DPR=2 pnpm lawmind:ui:agents-desk-mockups
```

Sources: `scripts/lawmind/ui-agents-desk-v2/*.html`
