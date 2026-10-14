# Changelog

All notable changes to this project will be documented in this file, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-14

### Added

- CLI: `--show-changes` prints every required change with its location, a plain-language description (e.g. `line 12: Change the list marker "*" to "-".`), and the exact current/formatted lines with visible whitespace.
- CLI: `--report-file <path>` writes a change report, in `--report-format text` (default), `json`, `gitlab` (Code Quality / Code Climate JSON, for `artifacts: reports: codequality:`), or `sarif` (SARIF 2.1.0, for `github/codeql-action/upload-sarif`). The report covers the full run, including read/format/write failures, with per-type counts and the exact before/after lines of every change. Examples: `examples/gitlab/.gitlab-ci.yml` (Code Quality) and `examples/github-actions/markdown-format-report.yml` (SARIF).
- **Trust Prettier configuration** plugin setting (off by default, stored per device) and CLI flag `--trust-prettier-config`, to load Prettier configuration that can run code.
- CLI: options that take a value also accept `--option=value`.
- Version and build information (release or development channel, source commit, commit date): in a new **About** section of the plugin settings, with a **Copy** button for bug reports, and in the CLI's `--version` output, also available as `markdown-formatter version`.

### Security

- Formatting does not run code from the formatted folder unless trusted. Prettier `plugins` are ignored, and a JavaScript/TypeScript Prettier config or a config that names a shared-config package stops formatting with an explanation. In 0.1.0 such configuration was executed, including by the read-only `check` mode.
- Plugin error logs pass text from the vault's project file as arguments, not as part of the format string, so it cannot inject format specifiers.
- CLI: the temporary file used for atomic writes is created exclusively, so an existing file or symlink with that name is never written through.
- The GitHub Actions examples verify the downloaded CLI's build provenance (`gh attestation verify`); the GitLab and Docker examples show how to pin its SHA-256.

### Fixed

- CRLF notes with preserved frontmatter were written with mixed line endings; the frontmatter now follows the formatted note's line endings.
- `--show-errors` compared line N with line N, so one inserted line marked every following line as different. It now lists the aligned changes that `--show-changes` describes, and states how many were left out.
- `--config` and `--ignore-file` rejected files inside the workspace whose names start with `..` (such as `..ignore`).
- File order in output and reports depended on the machine's locale; it is now the same everywhere.
- A frontmatter block closed by a line longer than `---` (such as `----`) was treated as closed.
- The plugin ignored notes with an upper-case `.MD` extension, which the CLI formats; both now match `.md` in any letter case.
- The JSON schema rejected repeated `ignore.patterns`, which the formatter accepts and which can be meaningful with `!` re-includes.
- Third-party notices covered only Prettier and markdownlint. Every distributed bundle now carries the license texts of all bundled packages, including Prettier's own third-party notices, and releases ship `THIRD_PARTY_LICENSES.txt` and the GNU GPL v3.0 text that the LGPL incorporates.

### Changed

- CLI: files are formatted several at a time; output order is unchanged.
- Production bundles are minified.
- `debounceMs` must be a whole number of milliseconds, as the JSON schema already required, and `ignore.file` is limited to 4096 characters.
- Pinned Node.js to `24.21.0`, the current "Krypton" LTS release (`.nvmrc`, `.node-version`). npm stays `11.19.0`, the version Node.js 24.21.0 bundles.

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
