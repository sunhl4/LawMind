# LawMind integrations

LawMind today focuses on **local workspace workflows** (tasks, drafts, Word/PPT export, audit). It does **not** ship embedded connectors to commercial DMS, billing, or practice-management systems.

## Supported integration pattern

- **Filesystem**: work lives under the configured **workspace**; artifacts land under `artifacts/` as documented in the [user manual](/LAWMIND-USER-MANUAL).
- **Export**: download rendered **`.docx` / `.pptx`** and upload or file into your DMS manually, or sync the workspace folder with firm-approved tooling.
- **API**: the desktop **local HTTP API** (loopback) can be used by scripts on the same machine for automation; keep binding to `127.0.0.1` unless your security team approves otherwise.

## What is not built-in

- Document management (iManage, NetDocuments, OpenText, etc.)
- Time tracking / billing systems
- E-discovery platforms

Treat those as **future** or **custom** integrations via export and IT-approved sync.

## Collaboration

Multi-assistant collaboration is described under **`GET /api/collaboration/summary`** in the [user manual](/LAWMIND-USER-MANUAL). It reflects in-app delegation and audit events, not external ticket systems.

https://docs.openclaw.ai/LAWMIND-INTEGRATIONS  
https://docs.openclaw.ai/LAWMIND-USER-MANUAL
