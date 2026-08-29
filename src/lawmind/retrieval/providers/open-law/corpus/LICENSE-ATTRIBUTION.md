# Open-law corpus attribution

## Bundled sample (`sample-statutes.jsonl` / embedded)

- **Content**: Short excerpts from publicly published PRC statutes/regulations for demo retrieval.
- **Not**: a complete Chinese law library; **not** 北大法宝 / Lexis redistributed text.
- **Use**: OSS pipeline demos only. Formal citations must be verified against official text (e.g. [flk.npc.gov.cn](https://flk.npc.gov.cn/)).
- **Hits**: Always marked `demo: true` with「演示语料」risk flag.

## External CORPUS (`LAWMIND_OPEN_LAW_CORPUS`)

Prepared and licensed by the operator. LawMind only reads locally.

## Live NPC FLK (`LAWMIND_OPEN_LAW_NPC=1`)

Official National Database of Laws and Regulations public search API. Government public information; site ToS / rate limits apply. Interface may change.

## Self-hosted caseopen (`LAWMIND_OPEN_LAW_CASEOPEN=1`)

- Software: [cncases/cases](https://github.com/cncases/cases) — MPL-2.0.
- Judgment texts: publicly published court documents hosted by the operator (often large; not shipped here).

## CourtListener / Free Law Project (`LAWMIND_OPEN_LAW_COURTLISTENER=1`)

Official REST v4 search. Optional token is a rate-limit credential, not a commercial corpus license. Harvard CAP live API is retired; historical CAP opinions are searched via this endpoint.

## EUR-Lex / CELLAR (`LAWMIND_OPEN_LAW_EURLEX=1`)

EU Publications Office public SPARQL. Government / official publication metadata; site rate limits apply.

## Japan e-Gov 法令 API (`LAWMIND_OPEN_LAW_EGOV_JP=1`)

Official Japanese statute keyword API (`laws.e-gov.go.jp`). Government public information.

## Community dumps (manual convert)

Converters accept FLK-style JSON and article-line text. Popular GitHub/HF packs without a clear LICENSE are **manual-only** — convert yourself after verifying rights; do not commit megabyte dumps into this repo.
