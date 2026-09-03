# Markdown Formatter

[![CI](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/actions/workflows/ci.yml/badge.svg)](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/actions/workflows/codeql.yml/badge.svg)](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/jjm-one/Markdown-Formatter-for-Obsidian/badge)](https://securityscorecards.dev/viewer/?uri=github.com/jjm-one/Markdown-Formatter-for-Obsidian)
[![Latest release](https://img.shields.io/github/v/release/jjm-one/Markdown-Formatter-for-Obsidian?include_prereleases&label=release)](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/jjm-one/Markdown-Formatter-for-Obsidian/total?label=downloads)](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases)
[![Obsidian 1.13.7+](https://img.shields.io/badge/Obsidian-1.13.7%2B-7c3aed)](https://obsidian.md)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)
[![License: LGPL v3](https://img.shields.io/badge/License-LGPL_v3-blue.svg)](LICENSE)

An Obsidian Markdown formatter shipped as both a **desktop plugin** and a **standalone CI/local CLI**. Both run the same pipeline — Prettier, markdownlint, `.editorconfig`, a shared project policy, and Obsidian-safe syntax preservation — so a note formats identically in Obsidian and in CI.

Repository: `https://github.com/jjm-one/Markdown-Formatter-for-Obsidian`

> **Pre-1.0.** Not in Obsidian's Community Plugins browser yet — install with BRAT or manually. The formatting policy may still change between 0.x releases; keep backups.

## Documentation

Start here:

- **[Obsidian plugin guide](docs/PLUGIN-GUIDE.md)** — install, first format, every setting and command, troubleshooting. Written for people who have never used a formatter.
- **[Command-line tool](docs/CLI-GUIDE.md)** — format a whole folder from a terminal: every option and exit code, plus git-hook, CI, and Docker recipes.

Reference:

- [Configuration](docs/CONFIGURATION.md) — the `.markdown-formatter.json` policy model, every key, and precedence.
- [Obsidian compatibility](docs/OBSIDIAN-COMPATIBILITY.md) — protected syntax and the markdownlint rules disabled by default.
- [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md) — internals.

## What it does

- Formats the active note on demand (command, hotkey, ribbon) or automatically on modify, open, or close — every automatic trigger is off by default.
- Resolves `.editorconfig` and trusted Prettier configuration per note, and applies configurable markdownlint fixes.
- Reads a committed vault-level `.markdown-formatter.json` policy and a gitignore-style `.markdown-formatter-ignore`, both shared by the plugin and the CLI.
- Preserves Obsidian syntax by default: Properties/frontmatter, wikilinks, embeds, callouts, block IDs, comments, MathJax, tags, inline footnotes, highlights, and fenced code blocks.
- Every configuration source reloads automatically — no Obsidian restart needed.

## Install the plugin

**BRAT (recommended).** Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins, run **BRAT: Add a beta plugin for testing**, and paste `https://github.com/jjm-one/Markdown-Formatter-for-Obsidian`. BRAT keeps it updated.

**Manual.** Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases) into `<Vault>/.obsidian/plugins/markdown-formatter/`, reload Obsidian, and enable it.

Full walkthrough and the rolling `main-latest` development channel: **[Obsidian plugin guide → Installing](docs/PLUGIN-GUIDE.md#installing-the-plugin)**.

## Use the CLI

Every release attaches `markdown-formatter-cli.cjs`, a bundled Node.js 24 CLI that runs the same formatter core:

```bash
node markdown-formatter-cli.cjs check .    # exit 1 if formatting is needed; never writes
node markdown-formatter-cli.cjs format .   # rewrite changed files in place
```

Exit codes: `0` clean · `1` changes required (`check` only) · `2` error. Ready-made [Docker](examples/docker/Dockerfile), [GitHub Actions](examples/github-actions/markdown-format-check.yml), and [GitLab CI](examples/gitlab/.gitlab-ci.yml) setups are in [`examples/`](examples/).

All options, verbosity levels, exclusions, and CI recipes: **[Command-line tool](docs/CLI-GUIDE.md)**.

## Configure

Drop `.markdown-formatter.json` at the vault root to share one policy across a vault. Every key is optional and overrides the corresponding default:

```json
{
  "proseWrap": "always",
  "markdownStructures": { "tables": "preserve" },
  "markdownlint": { "MD013": true }
}
```

Precedence: **built-in defaults → Obsidian settings UI → vault project file**. A complete, commented starter is [`.markdown-formatter.example.json`](.markdown-formatter.example.json); the full model, every key, and the default markdownlint rule set are in **[Configuration](docs/CONFIGURATION.md)**.

### Excluding notes

List gitignore-style patterns in `.markdown-formatter-ignore` at the vault root — `*` matches within a path segment, `**` crosses directories, `!` re-includes. The same file is honored by the plugin and the CLI. Details and the project-config `ignore` block: [Configuration](docs/CONFIGURATION.md).

## Triggers

| Trigger                                    | Setting          | Default          |
| ------------------------------------------ | ---------------- | ---------------- |
| Manual command / hotkey / ribbon           | —                | always available |
| Continuous after a vault write (debounced) | `formatOnModify` | off              |
| On file open                               | `formatOnOpen`   | off              |
| On last Markdown view close                | `formatOnClose`  | off              |

## Desktop only

The plugin uses Node.js-backed Prettier/markdownlint and filesystem configuration discovery, so it declares `isDesktopOnly: true` and does not run on Obsidian mobile — see [Architecture](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run dev   # watch build
npm run ci    # full gate: lint, types, tests + coverage, build, package
```

Run the suite with `npm test`. See [Testing](docs/TESTING.md), [Architecture](docs/ARCHITECTURE.md), and [Contributing](CONTRIBUTING.md).

## Releases & automation

Releases are GitHub Releases from SemVer tags (no `v` prefix; tags with a pre-release suffix such as `-alpha` or `-beta` publish as pre-releases), built and attested by an automated workflow that attaches `main.js`, `manifest.json`, `styles.css`, and the standalone CLI. A rolling `main-latest` prerelease tracks the newest successful `main` build.

Supply-chain hardening:

- CodeQL, Semgrep, and OpenSSF Scorecard on pushes and a schedule; `npm audit` in CI.
- The formatter core is fuzzed with jazzer.js on relevant PRs and weekly.
- Releases carry SLSA build provenance.
- Every GitHub Action is SHA-pinned and every workflow keeps least-privilege token scopes (enforced by `npm run check:repository`).
- Dependabot updates npm, Actions, and the example Docker image weekly, with grouped low-risk auto-merge.

## License

Copyright © 2026 jjm.one. Licensed under the **GNU Lesser General Public License v3.0 only** (`LGPL-3.0-only`) — see [LICENSE](LICENSE) and the texts under [LICENSES/](LICENSES/). The production bundle includes MIT-licensed third-party components; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Disclaimer

This software is provided **"as is", without warranty of any kind**, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. To the maximum extent permitted by applicable law, the authors and contributors accept **no liability** for any claim, damages, data loss, or other consequences arising from the use of, or inability to use, this software. Formatting rewrites file contents — keep backups or version control. These terms follow sections 15–17 of the GNU GPL v3, as incorporated by the LGPL v3.0; see [LICENSE](LICENSE).
