# Command-line tool

The **standalone CLI** formats every Markdown file in a folder from a terminal, without opening Obsidian. It is a single self-contained file that bundles Prettier and markdownlint, and it runs the exact same formatter core as the plugin — so `check` in CI matches what people see in Obsidian.

## Contents

- [Do you need this?](#do-you-need-this)
- [Install Node.js](#install-nodejs)
- [Get the CLI](#get-the-cli)
- [Run it on a folder](#run-it-on-a-folder)
- [`check` vs `format`](#check-vs-format)
- [Reading the output](#reading-the-output)
- [Options](#options)
- [Which files it looks at](#which-files-it-looks-at)
- [Sharing rules with the Obsidian plugin](#sharing-rules-with-the-obsidian-plugin)
- [Pre-commit hook](#pre-commit-hook)
- [Continuous integration](#continuous-integration)
- [Docker](#docker)
- [npm package](#npm-package)
- [Troubleshooting](#troubleshooting)

---

## Do you need this?

**Most people don't.** If you only want tidy notes inside Obsidian, install the [plugin](PLUGIN-GUIDE.md) and stop there.

Reach for the CLI when you want to:

- format **every** note in a vault or repository at once;
- fail a pull request in **CI** when notes aren't tidy;
- run the formatter from a **git pre-commit hook**;
- format a docs folder that isn't an Obsidian vault at all.

---

## Install Node.js

You need **Node.js 24 or newer**.

1. Install the current LTS from <https://nodejs.org>, or use a version manager such as [`nvm`](https://github.com/nvm-sh/nvm) / [`fnm`](https://github.com/Schniz/fnm).
2. Open a terminal — **Terminal**/**PowerShell** on Windows, **Terminal** on macOS, your usual shell on Linux.
3. Check it: `node --version` should print `v24` or higher.

## Get the CLI

Download **`markdown-formatter-cli.cjs`** from the [latest release](https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases) and put it somewhere handy (next to your vault, or a `tools/` folder). From a terminal:

```bash
curl -fsSL -o markdown-formatter-cli.cjs \
  https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/0.1.0/markdown-formatter-cli.cjs
node markdown-formatter-cli.cjs --version
```

Pin a specific version tag rather than "latest" so your results don't shift under you. The rolling `main-latest` tag always holds the CLI from the newest successful `main` build (mutable — testing only):

```bash
curl -fsSL -o markdown-formatter-cli.cjs \
  https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/main-latest/markdown-formatter-cli.cjs
```

## Run it on a folder

```bash
node markdown-formatter-cli.cjs <check|format> [folder]
```

If you omit the folder, the current directory is used.

```bash
# See what would change, without touching anything:
node markdown-formatter-cli.cjs check "/path/to/YourVault"

# See the exact line-by-line differences:
node markdown-formatter-cli.cjs check "/path/to/YourVault" --show-errors

# Apply the formatting (take a backup or start from a clean git status):
node markdown-formatter-cli.cjs format "/path/to/YourVault"
```

> On Windows PowerShell, quote paths that contain spaces; `/` and `\` both work.

## `check` vs `format`

|                   | `check`                                          | `format`                         |
| ----------------- | ------------------------------------------------ | -------------------------------- |
| Reads every `.md` | yes                                              | yes                              |
| Writes files      | **never**                                        | yes — only the ones that need it |
| Typical use       | CI, "is my vault tidy?", preview `--show-errors` | actually applying the formatting |

**Exit codes** (both commands):

| Code | Meaning                                                                         |
| ---: | ------------------------------------------------------------------------------- |
|  `0` | every scanned file already meets the policy (`check`) / run finished (`format`) |
|  `1` | `check` only — one or more files need formatting                                |
|  `2` | bad option, invalid or unloadable config, or an unreadable/unwritable file      |

`format` writes safely: each changed note is written to a temporary sibling file and then renamed, so a note is never left half-written if the write fails. Neither command makes git commits — that's up to you.

## Reading the output

```text
needs formatting  Daily/2026-02-01.md
needs formatting  Projects/roadmap.md
CHANGES REQUIRED: 42 file(s) checked; 2 need formatting, 40 clean, 0 failed.
```

```text
formatted         Daily/2026-02-01.md
OK: 42 file(s) processed; 1 formatted, 41 unchanged, 0 failed.
```

If a file can't be read or formatted, the CLI reports it, keeps going with the rest, and exits `2`:

```text
ERROR [format] Broken/bad.md: Could not format ...
FAILED: 42 file(s) checked; 1 need formatting, 40 clean, 1 failed.
```

## Options

| Option                      | What it does                                                                    |
| --------------------------- | ------------------------------------------------------------------------------- |
| `--show-errors`, `--errors` | In `check` mode, print the line-by-line "current vs expected" differences.      |
| `--max-errors <n>`          | Max differences shown per file (1–1000; default 20).                            |
| `--exclude "<glob>"`        | Skip extra paths for this run only. Repeatable.                                 |
| `--config <path>`           | Use a specific config file instead of `.markdown-formatter.json` in the folder. |
| `--ignore-file <path>`      | Use a specific ignore file instead of `.markdown-formatter-ignore`.             |
| `-q`, `--quiet`             | Print only the final summary line and any errors.                               |
| `--verbose`                 | Print every processed file with its status (including unchanged).               |
| `--debug`                   | Everything `--verbose` shows, plus the resolved config/ignore paths.            |
| `--verbosity <level>`       | `quiet` \| `normal` \| `verbose` \| `debug` (alternative to the flags above).   |
| `-h`, `--help`              | Full built-in help.                                                             |
| `-V`, `--version`           | CLI version and Node.js version.                                                |

The default config path is `.markdown-formatter.json` in the folder root. A missing default file falls back to the safe built-in defaults; a `--config` file that cannot be loaded stops the run with exit `2` (no silent fallback).

## Which files it looks at

- Scans `.md` files recursively, in every sub-folder.
- Never follows directory symlinks.
- Always skips `.git`, `.obsidian`, `.trash`, and `node_modules`.
- Reads `.markdown-formatter-ignore` from the folder root — same [pattern syntax](CONFIGURATION.md#formatting-exclusions) as the plugin.
- `--exclude "<glob>"` adds one-off exclusions for a single run.

## Sharing rules with the Obsidian plugin

Put a `.markdown-formatter.json` in the folder root (the plugin's **Create project configuration file** command generates one). The CLI reads the same file, so a CI `check` matches Obsidian.

- No file → the CLI uses the safe built-in defaults.
- Formatting, preservation, Prettier, `.editorconfig`, and markdownlint settings behave identically to the plugin.
- Obsidian-only keys — `formatOnModify`, `formatOnOpen`, `formatOnClose`, `showRibbonButton`, `debounceMs`, `stampUpdatedProperty`, `updatedProperty` — are accepted but ignored.

Field reference: [Configuration](CONFIGURATION.md).

## Pre-commit hook

Block a commit when Markdown isn't formatted — create `.git/hooks/pre-commit` (no extension) and `chmod +x` it:

```bash
#!/usr/bin/env bash
node tools/markdown-formatter-cli.cjs check . || {
  echo "Markdown needs formatting. Run: node tools/markdown-formatter-cli.cjs format ."
  exit 1
}
```

To auto-format and re-stage instead of blocking:

```bash
#!/usr/bin/env bash
node tools/markdown-formatter-cli.cjs format .
git add -A -- '*.md'
```

With the [`pre-commit`](https://pre-commit.com/) framework, call the CLI from a `local` hook.

## Continuous integration

Ready-made files live in [`examples/`](../examples/). GitHub Actions job that fails a pull request when notes aren't formatted:

```yaml
name: Markdown formatting
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  markdown-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
      - run: |
          curl -fsSL -o /tmp/mdf.cjs \
            https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/0.1.0/markdown-formatter-cli.cjs
      - run: node /tmp/mdf.cjs check .
```

If the vault is a repository subdirectory, point `check` at it: `node /tmp/mdf.cjs check ./docs/vault`.

GitLab CI, checking and producing a patch artifact instead of failing:

```yaml
markdown-format:
  image: node:24
  stage: test
  script:
    - curl -fsSL -o /tmp/mdf.cjs https://github.com/jjm-one/Markdown-Formatter-for-Obsidian/releases/download/0.1.0/markdown-formatter-cli.cjs
    - node /tmp/mdf.cjs format .
    - git diff > markdown-format.patch
  artifacts:
    when: always
    paths: [markdown-format.patch]
```

## Docker

[`examples/docker/Dockerfile`](../examples/docker/Dockerfile) wraps the released CLI in a small Node image — it downloads the CLI from a GitHub Release at build time, so there is no checkout or build:

```bash
docker build -t markdown-formatter --build-arg VERSION=0.1.0 examples/docker
docker run --rm -v "$PWD:/workspace" markdown-formatter check .   # or: format .
```

`VERSION` accepts any release tag or `main-latest`. The container runs as the unprivileged `node` user; add `--user "$(id -u):$(id -g)"` if `format` can't write your mounted files.

## npm package

Every release also attaches the `npm pack` `.tgz` (not published to the public registry). After installing it:

```bash
npx markdown-formatter check .
npx markdown-formatter format .
```

## Troubleshooting

**`node: command not found`** — Node.js isn't installed or isn't on your `PATH`. Reinstall and open a fresh terminal.

**"requires Node.js 24 or newer"** — `node --version` must be `v24`+.

**`Cannot find module '.../markdown-formatter-cli.cjs'`** — the path is wrong. `cd` into the folder that holds it, or pass the full path.

**Exit `2` with "Could not load configuration"** — `.markdown-formatter.json` is invalid JSON or has an unknown key. Fix it, or drop `--config` to use defaults.

**`check` says files need formatting but you can't see why** — add `--show-errors`.

**It reformatted a code block / Mermaid diagram** — set `markdownStructures.fencedCodeBlocks` to `"preserve"` (the default — check it wasn't changed).

**Slow on a huge vault** — narrow the scan with `--exclude` for attachments, archives, and generated folders.
