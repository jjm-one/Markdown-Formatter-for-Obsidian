# Testing strategy

Markdown Formatter uses multiple test layers because formatting bugs can either change Markdown text or break Obsidian lifecycle behavior.

## Test layers

### Formatter and configuration unit tests

`tests/config.test.ts`, `tests/preservation.test.ts`, `tests/formatting.test.ts`, `tests/prettier-trust.test.ts`, `tests/ignore.test.ts`, `tests/frontmatter.test.ts`, and `tests/errors.test.ts` verify:

- persisted settings validation and safe defaulting;
- vault project configuration precedence;
- project configuration validation;
- agreement of the built-in defaults, JSON schema, and example configuration, and conservative Obsidian-preservation defaults;
- refusal of Prettier configuration that can run code — without running it — unless trusted;
- ignore-file parsing, glob matching, root anchoring, and ordered re-inclusion;
- safe filtering of project-supplied Prettier options;
- markdownlint conflict suppression when a structure is preserved;
- GFM table formatting and table preservation;
- exact preservation of Obsidian properties/frontmatter, with line endings matching the formatted note;
- wikilinks and embeds;
- callouts and fold state;
- block IDs;
- Obsidian comments;
- MathJax inline/display math;
- tags;
- inline footnotes;
- highlights;
- fenced code blocks including Mermaid;
- write-only-when-changed behavior;
- re-entrancy protection.

The fixture `tests/fixtures/obsidian/all-syntax.txt` combines many Obsidian extensions, with irregular spacing, in a single note. Tests assert that their source-significant tokens survive a complete formatting pass. It is kept as `.txt` (and listed in `.prettierignore`) so no Markdown formatter reformats it.

### Standalone CLI tests

`tests/cli.test.ts` verifies:

- command-line argument parsing (`--option=value`, repeated options, last-wins verbosity);
- deterministic exit codes;
- missing/invalid configuration handling;
- recursive Markdown discovery;
- default exclusion of `.obsidian` and dependency metadata;
- symlink avoidance;
- check mode never writing files;
- format mode writing and becoming idempotent;
- shared Obsidian syntax preservation in headless mode;
- built-in CLI scan exclusions and project ignore patterns;
- shared ignore-file exclusions and explicit `--ignore-file` overrides;
- help/version surfaces (including build information) and bundled executable behavior;
- quiet/normal/verbose/debug argument handling;
- `--show-errors` diagnostics and their limit;
- deterministic file order;
- invalid option/path/config handling with exit code `2`;
- continuation after per-file formatter failures.

These tests execute the same `formatMarkdown()` core called by the Obsidian plugin.

`tests/diff.test.ts`, `tests/changes.test.ts`, and `tests/report.test.ts` cover the `--show-changes`/`--report-file` change-reporting pipeline: the line-diff algorithm reconstructs its input exactly (round-trip property tests), each formatting difference gets the right change kind and message, applying every reported change to the original reproduces the formatter output exactly, and each report format (`text`, `json`, `gitlab`, `sarif`) renders correctly, including read/format/write failures.

### Mocked Obsidian integration tests

`tests/plugin-integration.test.ts` runs the actual plugin class against a small Obsidian API mock. It verifies:

- command registration;
- manual formatting command behavior;
- ribbon creation/removal;
- modify-event debounce behavior;
- suppression of recursive modify events;
- format-on-open;
- format-on-close only after the final Markdown view closes;
- project configuration reload after vault changes;
- plugin unload cleanup;
- ignore-file skipping across manual/automatic formatting;
- ignore-file reload and creation commands;
- malformed project configuration safety-stop behavior and recovery;
- corrupt persisted settings normalization;
- vault read failures and non-Markdown input handling;
- optional updated-date property stamping (only on a real change, only if the property exists, custom name and Obsidian date format).

`tests/settings-tab.test.ts` covers the settings tab: reading and writing the active store, validation, and plugin-only settings.

The mock is intentionally narrow. It models only APIs used by this plugin, making API assumptions explicit and easy to update when the minimum supported Obsidian version changes.

### Repository contract

`npm run check:metadata` runs in `npm run verify` and CI:

- `check-versions.mjs` — `package.json`, `manifest.json`, `versions.json`, the example Dockerfile, and any release tag agree on the version;
- `check-repository.mjs` — license files, SPDX headers on every source file, repository URLs, consistent Node.js/npm pins, published license files, SHA-pinned Actions, and least-privilege workflow permissions.

The production build itself fails if a bundled package is under a license outside the permissive allow-list (see [Architecture → Build](ARCHITECTURE.md#build)).

## Static analysis

`npm run lint` uses typed ESLint rules and the official `eslint-plugin-obsidianmd` rules on the Obsidian runtime, while the standalone CLI/tests use typed TypeScript ESLint rules without Obsidian-only runtime restrictions, and the build/CI scripts get a light untyped pass. `npm run typecheck` validates the source tree against the real Obsidian API typings, and the tests as well (`tests/helpers.ts` bridges the few constructors where the mock differs). Both run as part of `npm run verify`.

## Running tests

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

Coverage:

```bash
npm run test:coverage
```

The CI workflow runs coverage tests before build/release packaging and performs a smoke test of the built bundles covering their license header and embedded third-party licenses, and the CLI's help, version, diagnostics, reports, Prettier trust, verbosity, invalid arguments, `check`, and `format`. The thin `src/cli/cli.ts` process entrypoint is excluded from line-coverage thresholds because it is exercised end-to-end as the built executable; the rest of `src/cli/` remains fully in the unit/integration coverage scope. A failing test blocks releases.

## Fuzzing

`fuzz/format.fuzz.cjs` is a [jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js) target that feeds arbitrary bytes to `formatMarkdown()` — the regex-heavy Obsidian tokenization and restore passes are the most likely place for a pathological-input crash or hang. `fuzz/corpus/` holds the committed seed inputs. A local `npm run fuzz` saves new interesting inputs to the git-ignored `fuzz/.corpus-local/`; add one to `fuzz/corpus/` by hand when it is worth keeping as a seed.

```bash
npm run fuzz          # build the bundle + explore for 60s, seeded from fuzz/corpus/ and fuzz/.corpus-local/
npm run fuzz:replay   # just re-run the committed corpus once (the PR regression check)
npm run build:fuzz    # only write fuzz/core.cjs (git-ignored), for a custom jazzer run
```

`.github/workflows/fuzz.yml`:

- **pull requests into `main`** touching `src/core/**`, `fuzz/**`, or `package-lock.json` replay `fuzz/corpus/` once (`-runs=0`) — deterministic, so a failure is a real regression, not a fuzzing flake;
- the **weekly run** and manual dispatch explore for new inputs (~10 min / ~2 min), seeded from the corpus; crash, timeout, and slow-unit inputs upload as an artifact.

`.clusterfuzzlite/` is a ready OSS-Fuzz build integration, not run in CI.

## Coverage policy

Coverage is generated with V8 and includes the plugin source. The thresholds are not a substitute for behavioral regression tests. Obsidian UI-builder callback wiring is less valuable to line-cover than formatting and lifecycle behavior; fixtures and integration assertions are the primary compatibility contract.

## Adding regression tests

Every bug that changes note contents should include a minimal regression fixture or inline input reproducing the original Markdown. If the bug concerns Obsidian-specific syntax, assert the exact source-significant token before and after formatting.

When adding a new Obsidian syntax preservation feature, add tests for all of the following where applicable:

1. protection/tokenization;
2. restoration;
3. a complete `formatFile` pass;
4. interaction with markdownlint;
5. project-config override behavior.
