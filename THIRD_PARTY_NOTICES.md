# Third-party notices

Markdown Formatter for Obsidian is licensed under the GNU Lesser General Public License v3.0 only (`LGPL-3.0-only`); see [LICENSE](LICENSE) and [LICENSES/](LICENSES/). Its distributed files — `main.js` (the Obsidian plugin) and `markdown-formatter-cli.cjs` (the standalone CLI) — also contain third-party software, which remains under its own licenses.

## Bundled software

- **[Prettier](https://github.com/prettier/prettier)** — MIT License, Copyright © James Long and contributors. Prettier itself contains code from further projects under the MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, and BlueOak-1.0.0 licenses, listed in the notices Prettier publishes with each release.
- **[markdownlint](https://github.com/DavidAnson/markdownlint)** — MIT License, Copyright © David Anson — together with the packages it depends on, including `micromark` and its extensions, `character-entities`, and `decode-named-character-reference` (MIT, Copyright © Titus Wormer), and `string-width`, `strip-ansi`, `ansi-regex`, and `get-east-asian-width` (MIT, Copyright © Sindre Sorhus).

## Full license texts

The production build generates **`THIRD_PARTY_LICENSES.txt`** from the exact set of packages compiled into the bundles: the name, version, and license of each package, its license text verbatim, and the notices it ships (including Prettier's complete third-party notices). That text is

- embedded at the end of `main.js` and `markdown-formatter-cli.cjs`, so every copy of a bundle carries it;
- included in the plugin ZIP and the npm package; and
- attached to every GitHub Release.

The build fails if a bundled package is under a license other than MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, or 0BSD, so no incompatible license can enter a release unnoticed.

Development tools (TypeScript, esbuild, ESLint, Vitest, jazzer.js, and others) are used only to build and test the project and are not distributed.
