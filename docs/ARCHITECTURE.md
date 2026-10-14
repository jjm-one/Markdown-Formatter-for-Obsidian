# Architecture

`src/` is split by surface. `src/plugin/` and `src/cli/` never import each other; both import only `src/core/`.

```text
src/
  core/    config.ts · errors.ts · frontmatter.ts · ignore.ts · obsidian-syntax.ts · pipeline.ts · index.ts (barrel)
  plugin/  main.ts · vault-config.ts · settings.ts · settings-tab.ts
  cli/     cli.ts · args.ts · run.ts · output.ts · types.ts · diff.ts · changes.ts · report.ts
```

## Shared formatter core

`src/core/` is the formatter both surfaces run, re-exported through `src/core/index.ts`. Neither surface implements a second formatter: a committed vault policy must produce the same Markdown in Obsidian and in CI.

| Module               | Responsibility                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`          | `DEFAULT_SETTINGS` — the single list of settings and their defaults — and everything derived from it: the `ProjectConfig` type, validation, merging a project file over a base, and Prettier option filtering. |
| `pipeline.ts`        | `formatMarkdown()`: resolve `.editorconfig`/Prettier options (with the trust check below), protect Obsidian syntax, run Prettier and markdownlint, then restore what was protected.                            |
| `obsidian-syntax.ts` | Frontmatter extraction, placeholder tokens for inline Obsidian syntax and links, and `prettier-ignore` shields for preserved blocks.                                                                           |
| `ignore.ts`          | Gitignore-style ignore patterns, compiled once into a matcher without dynamic regular expressions.                                                                                                             |
| `frontmatter.ts`     | Frontmatter detection and single-property edits, used by the plugin's updated-date stamping.                                                                                                                   |

## Obsidian plugin

Every trigger — command, hotkey, ribbon, modify, open, close — ends in `formatFile()` in `main.ts`, which:

1. resolves the effective settings: built-in defaults, then the plugin's settings, then the vault project file;
2. reads the note through the Vault API;
3. runs `formatMarkdown()` with the note's absolute path, so `.editorconfig` and Prettier configuration are found on disk;
4. refreshes an existing updated-date property, if enabled and the note changed;
5. writes through the Vault API only when the output differs.

`vault-config.ts` owns the vault-side files: it loads, validates, writes, and creates `.markdown-formatter.json` and the ignore file, and records the errors that block formatting. `settings.ts` defines the persisted plugin settings and validates them with the project-config rules. `settings-tab.ts` uses Obsidian 1.13 declarative setting definitions, so settings are searchable.

**Settings store.** When a valid `.markdown-formatter.json` exists and is enabled (`vaultConfig.active`), the settings tab reads the effective value (file, then plugin setting) and writes changes into the file through `updateProjectConfig()`. Otherwise it edits the plugin's own settings. `useProjectConfig`, `projectConfigPath`, and `trustPrettierConfig` always stay plugin settings. The text of the plugin's last write is remembered so its own modify event does not trigger a reload.

**Reloading.** The project file and the ignore file reload on vault `modify`/`create`/`delete`/`rename` events for their paths; all configuration also reloads on window focus and when the settings tab opens. A reload that changes the resolved configuration re-renders the tab. `.editorconfig` and Prettier configuration are read on every format (`cacheConfig: false`).

## Standalone CLI

`cli.ts` is the Node.js 24 entrypoint. `args.ts` parses arguments with `node:util` `parseArgs`, `run.ts` performs the run, `output.ts` prints it, and `types.ts` holds the shared data shapes. A run:

1. loads `.markdown-formatter.json` (or `--config`) from the workspace;
2. discovers `.md` files in code-point order, skipping symlinks, `.git`, `.obsidian`, `.trash`, `node_modules`, and ignored paths;
3. formats several files at a time through `formatMarkdown()`, keeping results in scan order;
4. compares (`check`) or writes atomically (`format`);
5. exits `0`, `1` (changes required), or `2` (error).

**Change reporting.** `diff.ts` computes a Myers line diff; `changes.ts` aligns lines on a formatting-insensitive key (so `* item` pairs with `- item`) and describes each difference with a kind, a message, and the exact before/after lines; `report.ts` renders the list as text, JSON, GitLab Code Quality, or SARIF. `--show-errors` is a bounded, compact view of the same list.

## Boundaries

- **Declarative project file.** `.markdown-formatter.json` cannot select a Prettier parser, change the file path, or load Prettier plugins; those options are removed before Prettier runs.
- **No code from the formatted folder by default.** Prettier configuration that can execute code — JavaScript/TypeScript config files, a config that names a shared-config module (detected with Prettier's own YAML parser), and `plugins` — is refused or removed unless the user opts in with the `trustPrettierConfig` plugin setting or `--trust-prettier-config`. The opt-in is never read from the vault.
- **Desktop only.** Prettier and EditorConfig resolution need Node.js file-system access, so the plugin is desktop-only; the CLI runs on Node.js.

## Build

`esbuild.config.mjs` produces two CommonJS bundles: `main.js` (Obsidian, Electron, and Node.js built-ins external) and `markdown-formatter-cli.cjs` (everything included). Most of each bundle is Prettier's language support, which stays included because Prettier also formats code in fenced blocks (when `fencedCodeBlocks` is `prettier`) and frontmatter (when `properties` is `format`).

Production builds are minified and licensed explicitly:

- each bundle starts with a header naming the project, its copyright, and `LGPL-3.0-only`;
- `scripts/third-party-licenses.mjs` reads esbuild's metafile, collects every bundled npm package with its license text and shipped notices into `THIRD_PARTY_LICENSES.txt`, and the build appends that text to both bundles; a package under a license outside the permissive allow-list fails the build.

`scripts/package.mjs` assembles the plugin ZIP — `main.js`, `manifest.json`, `styles.css`, and the license files — for a release or a rolling development build; `scripts/verify-package.mjs` checks it. The CLI ships separately on GitHub Releases and in the npm package.
