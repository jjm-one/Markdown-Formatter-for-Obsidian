# Architecture

`src/` is split by surface. `src/plugin/` and `src/cli/` never import each other; both import only `src/core/`.

```text
src/
  core/    config.ts · errors.ts · frontmatter.ts · ignore.ts · obsidian-syntax.ts · pipeline.ts · index.ts (barrel)
  plugin/  main.ts · settings.ts · settings-tab.ts
  cli/     cli.ts · cli-lib.ts
```

## Shared formatter core

`src/core/` is the compatibility boundary shared by both runtime surfaces, re-exported through `src/core/index.ts`. It owns:

- project configuration types, validation, and defaults (`config.ts`);
- safe Prettier option filtering and `.editorconfig` / Prettier configuration resolution (`config.ts`, `pipeline.ts`);
- gitignore-style discovery filtering (`ignore.ts`);
- Obsidian-specific syntax protection, restoration, and `prettier-ignore` preservation directives (`obsidian-syntax.ts`);
- markdownlint conflict suppression and fixes, and the final `formatMarkdown()` pipeline (`pipeline.ts`);
- non-destructive single-property edits to a note's YAML frontmatter (`frontmatter.ts`), used by the plugin's optional updated-date stamping.

Neither the Obsidian plugin nor the standalone CLI implements a second formatter. This is deliberate: a committed vault policy must produce the same Markdown in Obsidian and in CI.

## Obsidian plugin pipeline

For a Markdown file, `src/plugin/main.ts`:

1. resolves UI settings and optional vault project configuration;
2. reads the note through the Obsidian Vault API;
3. passes the contents, absolute file path, and effective settings to the shared formatter core;
4. if enabled and the format changed the note, refreshes an existing updated-date frontmatter property (`setFrontmatterProperty`, date via `moment` + Obsidian's `dateFormat`);
5. writes through the Vault API only when output differs.

The same path is used by continuous, open, close, command/hotkey, and ribbon triggers. `src/plugin/settings.ts` owns persisted plugin-setting validation/defaults, while `src/plugin/settings-tab.ts` uses Obsidian 1.13+ declarative setting definitions so settings are searchable and lifecycle code remains isolated from presentation code.

**Settings store.** When a valid `.markdown-formatter.json` is present and enabled (`isProjectConfigActive()`), it — not `data.json` — is the store the tab binds to: `getControlValue` returns the effective value (project override, then plugin setting) and `setControlValue` merges the change back into the file via `updateProjectConfig()`, which re-validates and rewrites it. Otherwise the tab edits the plugin's own settings. A `lastWrittenProjectConfig` fingerprint suppresses the reload triggered by the plugin's own write.

The persisted settings, the project configuration, and the ignore file are reloaded automatically: the config and ignore file on `vault` `modify`/`create`/`delete`/`rename` for their path, and all three on window `focus` and when the settings tab is opened (covering external edits and cross-device sync). Any reload that changes the resolved config re-renders the open settings tab (`settingTab.update()`). `.editorconfig` and Prettier config are re-resolved from disk on every format (`formatMarkdown(..., { cacheConfig: false })`), so an edit to them takes effect on the next format; the CLI keeps the cache within a single run.

## Standalone CLI pipeline

`src/cli/cli-lib.ts` and `src/cli/cli.ts` provide a Node.js 24 command-line surface:

1. resolve a workspace root;
2. load `.markdown-formatter.json` (or an explicit `--config`);
3. recursively discover Markdown while applying built-in scan exclusions plus the shared ignore policy;
4. call the shared `formatMarkdown()` function for each file;
5. either compare only (`check`) or write changes (`format`);
6. return deterministic CI exit codes.

The CLI does not follow directory symlinks and excludes `.git`, `.obsidian`, `.trash`, and `node_modules` by default.

## Boundaries

- **Declarative config.** The vault project configuration cannot select a Prettier parser, spoof the filepath, or load Prettier plugins; those keys are filtered before Prettier runs.
- **Desktop-only plugin.** Prettier/EditorConfig resolution needs Obsidian's Node.js-backed desktop adapter, so the plugin is desktop-only. The CLI is likewise Node.js (desktop/server/CI).

## Build

`esbuild.config.mjs` produces two bundles:

- `main.js` — plugin runtime, with Obsidian/Electron/Node built-ins external;
- `markdown-formatter-cli.cjs` — Node.js 24 CLI, formatter dependencies included.

The Obsidian ZIP contains only plugin assets and license notices. The CLI ships separately on GitHub Releases and inside the npm package archive.
