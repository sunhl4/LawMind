# True-manuscript fixtures (optional quality proof)

Place real `.docx` / `.doc` / `.pdf` contracts or complaints here to enable
the compare gate. In-repo NDA markdown must not be used as a stand-in.
If this folder has no binaries, tests and `pnpm lawmind:true-manuscript`
print an honest **SKIP** (exit 0 unless `LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1`).

Binary fixtures are gitignored (PII). Keep only this README in git.

```bash
pnpm lawmind:true-manuscript
# nightly / local fail-closed on missing fixtures:
LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript
```

Optional sidecar `*.baseline.json` next to a fixture, for example:

```json
{
  "file": "nda.docx",
  "minTextChars": 400,
  "mustContain": ["保密", "违约"],
  "kind": "contract"
}
```

Sidecars only check extracted text shape. They are not a 潘睿红线 / Copilot
plan compare. Drop those baselines only when you have the real files.
