# True-manuscript fixtures (optional)

Place real `.docx` / `.doc` / `.pdf` contracts or complaints here to enable
the compare gate. In-repo NDA markdown must not be used as a stand-in.
If this folder is empty, tests skip honestly.

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
