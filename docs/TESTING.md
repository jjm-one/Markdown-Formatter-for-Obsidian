# Testing strategy

Markdown Formatter uses multiple test layers because formatting bugs can either change Markdown text or break Obsidian lifecycle behavior.

## Test layers

### Formatter and configuration unit tests

`tests/config.test.ts`, `tests/preservation.test.ts`, `tests/formatting.test.ts`, `tests/ignore.test.ts`, `tests/frontmatter.test.ts`, and `tests/errors.test.ts` verify:

- persisted settings validation and safe defaulting;
- vault project configuration precedence;
- project configuration validation;
- ignore-file parsing, glob matching, root anchoring, and ordered re-inclusion;
- safe filtering of project-supplied Prettier options;
- markdownlint conflict suppression when a structure is preserved;
- GFM table formatting and table preservation;
- exact preservation of Obsidian properties/frontmatter;
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

The regression fixture at `tests/fixtures/obsidian/all-syntax.txt` intentionally combines many Obsidian extensions, with deliberately irregular spacing, in a single note. Tests assert that their source-significant tokens survive a complete formatting pass. It is kept as `.txt` (and listed in `.prettierignore`) so no Markdown formatter reformats it.

### Standalone CLI tests

`tests/cli.test.ts` verifies:

- command-line argument parsing;
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
- help/version surfaces and bundled executable behavior;
- quiet/normal/verbose/debug argument handling;
- detailed `--show-errors` diagnostics and diagnostic limits;
- invalid option/path/config handling with exit code `2`;
- continuation after per-file formatter failures.

These tests execute the same `formatMarkdown()` core called by the Obsidian plugin.

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

`tests/frontmatter.test.ts` covers the `setFrontmatterProperty` helper directly: existing top-level scalars only, no key creation, quoting of ambiguous values, and byte-for-byte preservation of everything else.

The mock is intentionally narrow. It models only APIs used by this plugin, making API assumptions explicit and easy to update when the minimum supported Obsidian version changes.

### Repository contract

Release-critical metadata — version alignment, license, repository URLs, SHA-pinned Actions, the schema/example/defaults staying in sync, and the conservative Obsidian-preservation defaults — is enforced by `npm run check:metadata` (`check-versions.mjs`, `check-obsidian-compat.mjs`, `check-repository.mjs`), which runs in `npm run verify` and CI.

## Static analysis

`npm run lint` uses typed ESLint rules and the official `eslint-plugin-obsidianmd` rules on the Obsidian runtime, while the standalone CLI/tests use typed TypeScript ESLint rules without Obsidian-only runtime restrictions, and the build/CI scripts get a light untyped pass. `npm run typecheck` validates the complete source tree. Both run as part of `npm run verify`.

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

The CI workflow runs coverage tests before build/release packaging and performs a smoke test of the bundled CLI covering help, version, diagnostics, verbosity, invalid arguments, `check`, and `format`. The thin `src/cli/cli.ts` process entrypoint is excluded from line-coverage thresholds because it is exercised end-to-end as the built executable; `src/cli/cli-lib.ts` remains fully in the unit/integration coverage scope. A failing test blocks releases.

## Fuzzing

`fuzz/format.fuzz.cjs` is a [jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js) target that feeds arbitrary bytes to `formatMarkdown()` — the regex-heavy Obsidian tokenization and restore passes are the most likely place for a pathological-input crash or hang.

```bash
npm run fuzz          # build the bundle + fuzz for 60s
npm run build:fuzz    # just write fuzz/core.cjs (git-ignored), e.g. for a custom jazzer run
```

`.github/workflows/fuzz.yml` runs it with jazzer.js on every PR that touches `src/core/**` or `fuzz/**` (~2 min) and once a week (~10 min); crash inputs upload as an artifact. `.clusterfuzzlite/` is a ready OSS-Fuzz build integration but is not run in CI — ClusterFuzzLite's Action has no JavaScript path.

## Coverage policy

Coverage is generated with V8 and includes the plugin source. The thresholds are deliberately meaningful but not treated as a substitute for behavioral regression tests. Obsidian UI-builder callback wiring is less valuable to line-cover than formatting and lifecycle behavior; fixtures and integration assertions are the primary compatibility contract.

## Adding regression tests

Every bug that changes note contents should include a minimal regression fixture or inline input reproducing the original Markdown. If the bug concerns Obsidian-specific syntax, assert the exact source-significant token before and after formatting.

When adding a new Obsidian syntax preservation feature, add tests for all of the following where applicable:

1. protection/tokenization;
2. restoration;
3. a complete `formatFile` pass;
4. interaction with markdownlint;
5. project-config override behavior.
