# Changelog

All notable changes to this project will be documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CLI: `--show-changes` prints a descriptive, line-referenced list of required changes (e.g. `line 12: Remove trailing whitespace.`) instead of raw before/after diffs.
- CLI: `--report-file <path>` writes a change report, in `--report-format text` (default), `json`, `gitlab` (Code Quality / Code Climate JSON, for `artifacts: reports: codequality:`), or `sarif` (SARIF 2.1.0, for `github/codeql-action/upload-sarif`). The report always covers the full run, including read/format/write failures. New examples: `examples/gitlab/.gitlab-ci.yml` (Code Quality) and `examples/github-actions/markdown-format-report.yml` (SARIF).
- Opt-in formatting for non-Markdown files: a new `additionalFileTypes` config key (plugin settings tab and `.markdown-formatter.json`/CLI) lists extensions — `json`, `json5`, `jsonc`, `canvas`, `excalidraw`, `yaml`, `yml`, `css`, `less`, `scss`, `html`, `htm`, `graphql`, `gql`, `xml`, `bpmn`, `toml`, `php`, `sql` — that also get plain Prettier formatting, with `.editorconfig`/Prettier config resolution applying exactly as it does for Markdown. Off by default; it is a strict allowlist, so any other extension, including every binary format, is never read or written. XML/BPMN, TOML, and PHP/SQL formatting are provided by the new `@prettier/plugin-xml`, `prettier-plugin-toml`, `@prettier/plugin-php`, and `prettier-plugin-sql` dependencies, bundled directly into the plugin and CLI. Format on close and the updated-date property remain Markdown-only, since both depend on Markdown-specific Obsidian concepts.

### Known limitations

- The `toml`/`php`/`sql` additional-file-type support adds roughly 39MB to `main.js`/`markdown-formatter-cli.cjs` combined, over 30MB of which is `prettier-plugin-toml`'s embedded WASM engine. This is a one-time bundle-size cost with no effect on formatting speed. Java support (`prettier-plugin-java`) was evaluated but not included: its `web-tree-sitter`-based parser needs separate `.wasm` asset files shipped alongside the bundle, which is incompatible with this project's single-file plugin/CLI distribution and was not feasible to verify inside Obsidian's sandboxed runtime.

### Changed

- Pinned Node.js to `24.21.0`, the current "Krypton" LTS release (`.nvmrc`, `.node-version`). npm stays `11.19.0` — already the version 24.21.0 bundles.
- Renamed the "Format current Markdown file" command/ribbon action to "Format current file", now that it also covers `additionalFileTypes`. The command ID is unchanged, so existing hotkey bindings still work.

## [0.1.0] - 2026-09-03

First public release. Distributed through BRAT and as a GitHub Release — not yet
in the Obsidian community plugin browser.

### Added

- **Obsidian desktop plugin** — format the active note from a command, hotkey, or ribbon button, or automatically on modify, open, or close.
- **Standalone Node.js CLI** (`markdown-formatter-cli.cjs`) with `check` and `format` modes for local runs and CI. It bundles Prettier and markdownlint and runs the exact same formatter core as the plugin.
- **Obsidian-safe preservation** of Properties/frontmatter, wikilinks and embeds, callouts and fold state, block IDs, comments, MathJax inline/display math, tags, inline footnotes, highlights, and fenced code blocks (including Mermaid).
- **Shared configuration** — a vault-level `.markdown-formatter.json` policy file read by both the plugin and the CLI, `.editorconfig` and Prettier config integration, configurable markdownlint fixes, and gitignore-style exclusions (`.markdown-formatter-ignore`).
- **Live settings sync** — the settings tab and `.markdown-formatter.json` stay in step: when a config file exists it becomes the store, and edits from the tab, from disk, or from another device are picked up automatically. Local (file) settings override global (plugin) settings.
- **Optional updated-date stamping** (off by default) — when enabled, editing an open note sets an existing `updated` frontmatter key (name configurable) to the current date, using Obsidian's own date format. The key is never added to notes that lack it; plugin-only.
- **Supply-chain hardening** — least-privilege workflow permissions, SHA-pinned Actions and digest-pinned images, `npm ci` from the committed lockfile, a 7-day Dependabot cooldown, Semgrep and CodeQL SAST, jazzer.js fuzzing of the formatter core, and SLSA build provenance attached to every release as a `.intoto.jsonl` asset.
- **Automated releases** — versioned GitHub Releases from SemVer tags, plus a rolling `main-latest` prerelease that tracks the newest successful `main` build.
