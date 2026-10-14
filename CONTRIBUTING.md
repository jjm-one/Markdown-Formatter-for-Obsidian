# Contributing

Contributions are welcome through issues and pull requests at:

`https://github.com/jjm-one/Markdown-Formatter-for-Obsidian`

## Development requirements

- Node.js 24 (see `.nvmrc` and `.node-version`).
- npm.
- Obsidian desktop for integration testing.

Install dependencies and start the development watcher:

```bash
npm install
npm run dev
```

For local Obsidian testing, clone or symlink the repository into:

```text
<Vault>/.obsidian/plugins/markdown-formatter/
```

The development build writes `main.js` at the repository root.

## Branch workflow

- `main` — stable. Tagged releases (`X.Y.Z`) are cut from here; publishes the `main-latest` rolling prerelease.
- `develop` — integration branch. Publishes the `develop-latest` rolling prerelease.
- Feature branches — branch off `develop`, PR back into `develop`. A push runs only the unit tests; the full check suite runs on the PR.

Promotion to a release is a `develop` → `main` PR (full suite runs), then a tag on `main`.

## Before opening a pull request

```bash
npm run ci   # lint, types, tests + coverage, build, package, verify
```

- When behavior changes, test the relevant formatting trigger in Obsidian desktop.
- When a setting changes, update `DEFAULT_SETTINGS` in `src/core/config.ts`, the JSON schema, the example config, and the docs together — `tests/config.test.ts` fails if they disagree.
- Changes that alter note contents should add a regression test — see [`docs/TESTING.md`](docs/TESTING.md).

## Commit messages

This project uses [gitmoji](https://gitmoji.dev/) — start the subject line with an
intention emoji, e.g. `✨ Add …`, `🐛 Fix …`, `📝 Update docs …`, `♻️ Refactor …`,
`✅ Add tests …`. Dependabot is configured to prefix its commits with `⬆️`, and
`npm version` prefixes release commits with `🔖`.

## Formatting behavior changes

Changes to Prettier, markdownlint, shielding, or preservation rules can rewrite user files. Treat these as user-visible even when the API surface is unchanged: add a changelog entry and include before/after Markdown examples in the pull request.

Dependabot opens update pull requests for npm packages and GitHub Actions; review major formatter/parser upgrades manually — they can alter output.

## License

By contributing, you agree that your contribution is provided under the repository's GNU Lesser General Public License v3.0 (`LGPL-3.0-only`).

- Start every new source file with the SPDX header used throughout the repository (`SPDX-FileCopyrightText` and `SPDX-License-Identifier: LGPL-3.0-only`); `npm run check:repository` enforces it.
- Runtime dependencies end up in the distributed bundles. They must use a permissive license (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, or 0BSD) — the production build fails otherwise — and their license texts are collected into `THIRD_PARTY_LICENSES.txt` automatically. Update the summary in `THIRD_PARTY_NOTICES.md` when you add or remove one.
