# LawMind policy file (optional)

Firm IT can ship a **read-only policy file** next to the LawMind workspace to document intended guardrails (for example disabling web search or fixing retrieval mode). The desktop app may add runtime enforcement in a future release; today this file is **documentation-first** so procurement and IT can agree on settings.

## Location

- Recommended: `<workspace>/lawmind.policy.json` (same directory as `MEMORY.md` and other workspace roots).
- Alternative paths may be documented per release; keep one canonical copy in internal runbooks.

## Example

See the repository sample at `docs/examples/lawmind.policy.json.sample` (copy and adjust; do not commit real secrets).

## Keys (illustrative)

| Key              | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `schemaVersion`  | File format version                                                |
| `allowWebSearch` | When `false`, operators should disable web search in the UI or env |
| `retrievalMode`  | Hint for retrieval strategy (`auto`, `legal`, etc.)                |

## Enforcement

- **Desktop local server**: On startup, after `.env.lawmind` is loaded, the server reads **`lawmind.policy.json`** from the workspace root and applies supported keys to `process.env` (see `apps/lawmind-desktop/server/lawmind-policy.ts`). **`GET /api/health`** returns a **`policy`** object (`loaded`, `path`, `applied`, and declared flags) so IT can verify enforcement.
- **`allowWebSearch: false`**: Forces web search **off** for `/api/chat` even if the UI toggle requests it.
- **`retrievalMode`** / **`enableCollaboration`**: Set `LAWMIND_RETRIEVAL_MODE` and `LAWMIND_ENABLE_COLLABORATION` for the server process (restart the desktop local API after changing the file).

## Related docs

- [LawMind private deploy](/LAWMIND-PRIVATE-DEPLOY)
- [LawMind delivery](/LAWMIND-DELIVERY)

https://docs.openclaw.ai/LAWMIND-POLICY-FILE  
https://docs.openclaw.ai/LAWMIND-PRIVATE-DEPLOY  
https://docs.openclaw.ai/LAWMIND-DELIVERY
