# LawMind template authoring

LawMind renders deliverables from **Word (`.docx`)** and **PowerPoint (`.pptx`)** templates under the workspace.

## Directory layout

| Path                               | Purpose                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `workspace/templates/word/`        | Built-in and uploaded Word templates                   |
| `workspace/templates/ppt/`         | Built-in and uploaded PPT templates                    |
| `workspace/lawmind/templates.json` | Registry of uploaded templates (managed by the engine) |

Built-in template metadata lives in `src/lawmind/templates/index.ts` (`BuiltInTemplateSpec`, categories: `contracts`, `litigation`, `client`, `internal`).

## Placeholders

- Word: use mustache placeholders (double curly braces around a dotted path such as `field.path`); run `scanDocxPlaceholders` when registering uploads.
- PPT: slide layouts follow the same registry; see `render-pptx.ts` for output wiring.
- Draft fields are mapped via `suggestPlaceholderFieldPaths` and template `placeholderMap` on uploaded records.

## Resolution flow

1. Router / draft picks a `templateId` on `ArtifactDraft`.
2. `resolveTemplate(workspaceDir, templateId)` in `src/lawmind/templates/index.ts` returns built-in, uploaded, or fallback.
3. `renderDocx` / `renderPptx` fills placeholders and writes under the matter output path.

## Registering an uploaded template

Use the desktop **Settings → Templates** flow or `registerUploadedTemplate` (engine API) after copying the file into the workspace templates tree. The registry entry must include `format`, `label`, `sourcePath`, and `placeholderMap`.

## Built-in categories

Templates are grouped for UI (`GET /api/templates/built-in`) by `BuiltInTemplateCategory`. Add a new built-in by extending `BuiltInTemplateSpec` in `index.ts` and placing the file under `workspace/templates/word/` or `ppt/`.
