# Architecture

`src/` is split by surface. `src/plugin/` and `src/cli/` never import each other; both import only `src/core/`.

```text
src/
  core/    config.ts · errors.ts · frontmatter.ts · ignore.ts · obsidian-syntax.ts · other-formats.ts · pipeline.ts · index.ts (barrel)
  plugin/  main.ts · settings.ts · settings-tab.ts
  cli/     cli.ts · cli-lib.ts · diff.ts · changes.ts · report.ts
```

## Shared formatter core

`src/core/` is the compatibility boundary shared by both runtime surfaces, re-exported through `src/core/index.ts`. It owns:

- project configuration types, validation, and defaults (`config.ts`);
- safe Prettier option filtering and `.editorconfig` / Prettier configuration resolution (`config.ts`, `pipeline.ts`);
- gitignore-style discovery filtering (`ignore.ts`);
- Obsidian-specific syntax protection, restoration, and `prettier-ignore` preservation directives (`obsidian-syntax.ts`);
- markdownlint conflict suppression and fixes, and the final `formatMarkdown()` pipeline (`pipeline.ts`);
- non-destructive single-property edits to a note's YAML frontmatter (`frontmatter.ts`), used by the plugin's optional updated-date stamping;
- the opt-in `additionalFileTypes` allowlist and its Prettier parser mapping (`other-formats.ts`), and the `formatOtherFile()` pipeline that runs plain Prettier formatting (no Obsidian-specific protection) for those extensions (`pipeline.ts`).

Neither the Obsidian plugin nor the standalone CLI implements a second formatter. This is deliberate: a committed vault policy must produce the same Markdown in Obsidian and in CI.

## Obsidian plugin pipeline

For a formattable file (a `.md` note, or a file whose extension is in the vault's opt-in `additionalFileTypes`), `src/plugin/main.ts`'s `formatFile()`:

1. resolves UI settings and optional vault project configuration;
2. checks the extension against `isFormattableFile()` — Markdown, or an allowlisted extra type;
3. reads the file through the Obsidian Vault API;
4. dispatches to the shared formatter core: `formatMarkdown()` for `.md`, `formatOtherFile()` for everything else;
5. for Markdown only, if enabled and the format changed the note, refreshes an existing updated-date frontmatter property (`setFrontmatterProperty`, date via `moment` + Obsidian's `dateFormat`);
6. writes through the Vault API only when output differs.

The same path is used by continuous, open, command/hotkey, and ribbon triggers. Format on close and the updated-date property stay Markdown-only by design: Obsidian's workspace API only reports which Markdown views are open, so there is no reliable "last view of this file closed" signal for other extensions, and frontmatter is a Markdown/Obsidian concept with no equivalent in JSON, XML, and the like.

`src/plugin/settings.ts` owns persisted plugin-setting validation/defaults, while `src/plugin/settings-tab.ts` uses Obsidian 1.13+ declarative setting definitions so settings are searchable and lifecycle code remains isolated from presentation code.

**Settings store.** When a valid `.markdown-formatter.json` is present and enabled (`isProjectConfigActive()`), it — not `data.json` — is the store the tab binds to: `getControlValue` returns the effective value (project override, then plugin setting) and `setControlValue` merges the change back into the file via `updateProjectConfig()`, which re-validates and rewrites it. Otherwise the tab edits the plugin's own settings. A `lastWrittenProjectConfig` fingerprint suppresses the reload triggered by the plugin's own write.

The persisted settings, the project configuration, and the ignore file are reloaded automatically: the config and ignore file on `vault` `modify`/`create`/`delete`/`rename` for their path, and all three on window `focus` and when the settings tab is opened (covering external edits and cross-device sync). Any reload that changes the resolved config re-renders the open settings tab (`settingTab.update()`). `.editorconfig` and Prettier config are re-resolved from disk on every format (`formatMarkdown(..., { cacheConfig: false })`), so an edit to them takes effect on the next format; the CLI keeps the cache within a single run.

## Standalone CLI pipeline

`src/cli/cli-lib.ts` and `src/cli/cli.ts` provide a Node.js 24 command-line surface:

1. resolve a workspace root;
2. load `.markdown-formatter.json` (or an explicit `--config`);
3. recursively discover Markdown, plus any `additionalFileTypes` extensions, while applying built-in scan exclusions plus the shared ignore policy;
4. call the shared formatter core for each file — `formatMarkdown()` for `.md`, `formatOtherFile()` for an allowlisted extra type;
5. either compare only (`check`) or write changes (`format`);
6. return deterministic CI exit codes.

The CLI does not follow directory symlinks and excludes `.git`, `.obsidian`, `.trash`, and `node_modules` by default.

**Change reporting** (`--show-changes`, `--report-file`) is a separate concern layered on top of the same before/after text: `diff.ts` computes a line-level edit script (Myers' algorithm), `changes.ts` classifies each hunk into a human-readable change (trailing whitespace, indentation, inserted/removed lines, …), and `report.ts` renders that list as plain text or as one of two CI-native formats — GitLab Code Quality JSON or GitHub-compatible SARIF.

## Boundaries

- **Declarative config.** The vault project configuration cannot select a Prettier parser, spoof the filepath, or load Prettier plugins; those keys are filtered before Prettier runs.
- **Extension allowlist, not a blocklist.** `additionalFileTypes` is checked against a fixed list of supported extensions (`SUPPORTED_EXTRA_EXTENSIONS` in `other-formats.ts`) both when the config loads and when a file is formatted, so an unsupported or binary extension — including a typo — can never reach the formatter.
- **Desktop-only plugin.** Prettier/EditorConfig resolution needs Obsidian's Node.js-backed desktop adapter, so the plugin is desktop-only. The CLI is likewise Node.js (desktop/server/CI).

## Build

`esbuild.config.mjs` produces two bundles:

- `main.js` — plugin runtime, with Obsidian/Electron/Node built-ins external;
- `markdown-formatter-cli.cjs` — Node.js 24 CLI, formatter dependencies included.

The Obsidian ZIP contains only plugin assets and license notices. The CLI ships separately on GitHub Releases and inside the npm package archive.

Three of the `additionalFileTypes` parsers (`toml`, `php`, `sql`) are third-party Prettier plugins bundled directly into both output files, since the Obsidian ZIP and the CLI executable each ship as a fixed, self-contained set of files with no `node_modules` alongside them. Their underlying parsing engines add roughly 39MB combined — over 30MB of that is `prettier-plugin-toml`'s embedded `@taplo/lib` WASM engine — which is why both bundles are tens of megabytes rather than a few. This is a one-time size cost with no runtime performance effect; see `THIRD_PARTY_NOTICES.md` for their licenses.
