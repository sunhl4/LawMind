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

## Before release (fail-closed)

- [ ] At least one real, desensitized contract or complaint is in this folder.
- [ ] Optional `*.baseline.json` sidecars describe the expected text shape.
- [ ] `LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript` passes.
- [ ] The report is written to `lawmind/metrics/true-manuscript-report.json`.
- [ ] `pnpm lawmind:release-readiness` no longer reports the true-manuscript
      section as an honest SKIP.
- [ ] Binaries are **not** committed (PII); keep only this README in git.

If any item is missing, leave `GOALS.md` P0-1 unchecked. Do not use the in-repo
NDA markdown or synthetic documents as a stand-in.

## What counts as a true manuscript

A desensitized document a lawyer actually worked on: a signed contract, a filed
complaint, a court judgment, or a real NDA. Keep parties, amounts, addresses and
seals redacted; keep the structure and clause wording intact so extraction is
meaningful.

Do **not** drop any of these here:

- the in-repo NDA markdown (it is a template, not evidence);
- synthetic contracts generated for demos;
- historical sample documents from another product;
- anything that has not been reviewed for client consent.

## Step by step

1. Copy the desensitized file into this folder (binaries are gitignored).
2. `pnpm lawmind:true-manuscript -- --write-baseline` drafts `*.baseline.json`
   for new files; it never overwrites an existing sidecar.
3. A lawyer reviews `mustContain` / `kind` / `minTextChars` and confirms the sidecar.
4. `LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript` until green.
   The trend report lands under `<workspace>/lawmind/metrics/` (default `./workspace`).

Release context, including which other gates still need external input, is in
[`docs/lawmind/RELEASE-EXTERNAL-INPUTS.md`](../../docs/lawmind/RELEASE-EXTERNAL-INPUTS.md).
