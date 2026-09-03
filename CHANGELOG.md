# Changelog

All notable changes to this project will be documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
