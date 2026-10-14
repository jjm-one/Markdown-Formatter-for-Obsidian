# Configuration

> This is the full reference for the `.markdown-formatter.json` policy file. For a plain-language tour of each setting in the Obsidian settings tab, see the **[Obsidian plugin guide](PLUGIN-GUIDE.md)**.

Markdown Formatter combines three configuration layers:

1. Built-in safe defaults.
2. User settings stored by Obsidian (per install).
3. Optional vault-level `.markdown-formatter.json` settings.

The vault-level file has the highest precedence for the settings it defines, which makes a committed vault policy reproducible across machines.

When this file exists (and _Use vault project configuration_ is on), it is also the store the Obsidian settings tab reads and writes: editing a setting in the UI updates this file, and editing this file — in another editor, or via device sync — updates the UI. The plugin's own stored settings are used only when there is no file, or the setting is not named in it. The standalone CLI reads the same file.

## EditorConfig and Prettier

When `usePrettierConfig` is `true` (the default), each note is formatted with the `.editorconfig` and Prettier configuration that apply to it. Prettier reads `.editorconfig` and maps these keys:

| `.editorconfig` key                | Prettier option | Effect on Markdown                                                                       |
| ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `end_of_line` (`lf`, `crlf`, `cr`) | `endOfLine`     | Line endings of the whole note.                                                          |
| `indent_style` (`space`, `tab`)    | `useTabs`       | Indentation of nested lists and reformatted code.                                        |
| `indent_size` / `tab_width`        | `tabWidth`      | Width of that indentation (`indent_size` with `indent_style = space`, else `tab_width`). |
| `max_line_length` (number, `off`)  | `printWidth`    | Wrapping width; visible only with `proseWrap: "always"`.                                 |
| `quote_type`                       | `singleQuote`   | Only code inside fenced blocks that Prettier may format.                                 |

`charset`, `insert_final_newline`, and `trim_trailing_whitespace` are not used: a formatted note always ends with exactly one newline and has no trailing whitespace except a two-space hard line break.

Precedence, lowest first: `.editorconfig` → Prettier config file → the `prettier` object in `.markdown-formatter.json` → `proseWrap`, which always applies. markdownlint fixes run afterwards.

Both are found by searching upward from the note's folder. The `.editorconfig` search stops at a file with `root = true` or at the folder that contains `.git` or `.hg`; outside a repository, put `root = true` in the vault's `.editorconfig` so files further up the disk do not apply. The plugin re-reads both on every format; the CLI reads them once per run.

### Prettier options in the project file

The `prettier` object accepts Prettier options and ignores `parser`, `filepath`, and `plugins` — the formatter always uses Prettier's Markdown parser for the note being formatted.

### Prettier configuration that can run code

Some Prettier configuration executes code: JavaScript/TypeScript config files (`prettier.config.js`, `.prettierrc.mjs`, …), a config whose whole value names a shared-config package (`"@company/prettier-config"`), and `plugins`. Because a vault or repository may come from someone else, none of it runs by default:

- `plugins` in a Prettier config file are ignored;
- a JavaScript/TypeScript config, or one that names a shared-config package, stops formatting with an error that explains why.

Declarative files — `.prettierrc`, `.prettierrc.json`, `.yaml`, `.json5`, `.toml`, and an inline `"prettier"` object in `package.json` — always work. To load code-capable configuration, turn on **Trust Prettier configuration** in the plugin settings (stored on the device, never in the vault) or pass `--trust-prettier-config` to the CLI, only for vaults and repositories you trust.

## Formatting triggers

```json
{
  "formatOnModify": false,
  "formatOnOpen": false,
  "formatOnClose": false,
  "showRibbonButton": true,
  "debounceMs": 900
}
```

`formatOnModify` is tied to Obsidian vault modification events and is debounced. Open/close triggers can be combined with it or used independently.

## Updated-date property

```json
{
  "stampUpdatedProperty": false,
  "updatedProperty": "updated"
}
```

When `stampUpdatedProperty` is `true`, the plugin sets the frontmatter key named by `updatedProperty` to the current date whenever you edit an open note — even if the note was already clean and nothing was reformatted. The key is only refreshed if it **already exists** in the note's frontmatter — it is never added, and notes without it are untouched.

The date is rendered with the format from Obsidian's **Settings → General → Date format** (default `YYYY-MM-DD`). `updatedProperty` accepts 1–64 letters, digits, spaces, hyphens, or underscores (e.g. `updated`, `modified`, `Last Update`).

This is a plugin-only, live-editing feature; the CLI accepts both keys but ignores them.

## Markdown structures

Each structure can be normalized by Prettier or preserved in source form:

```json
{
  "markdownStructures": {
    "tables": "prettier",
    "lists": "prettier",
    "fencedCodeBlocks": "preserve",
    "blockquotes": "prettier",
    "horizontalRules": "prettier"
  }
}
```

Preservation also disables markdownlint auto-fixes that would otherwise rewrite the same structure.

## Link syntax

```json
{
  "links": {
    "markdownLinks": "prettier",
    "referenceDefinitions": "preserve",
    "obsidianWikilinks": "preserve",
    "autolinks": "preserve"
  }
}
```

Wikilinks and embeds are preserved by default because their syntax is meaningful to Obsidian.

## Obsidian syntax

```json
{
  "obsidianSyntax": {
    "properties": "preserve",
    "callouts": "preserve",
    "blockIds": "preserve",
    "comments": "preserve",
    "math": "preserve",
    "tags": "preserve",
    "inlineFootnotes": "preserve",
    "highlights": "preserve"
  }
}
```

`preserve` is the recommended setting. Setting a construct to `format` lets generic formatting change it, without source-level preservation.

A preserved Properties block keeps its content byte-for-byte; only its line endings follow the rest of the formatted note, so a note never mixes line endings.

## markdownlint

markdownlint runs after Prettier and applies only the fixes that its enabled rules
provide. Vault-level rules are merged with the UI/default rules rule-by-rule, so you
only need to specify overrides.

### Rules disabled by default

The default rule set is intentionally compatible with Obsidian:

```json
{
  "markdownlint": {
    "default": true,
    "MD013": false,
    "MD018": false,
    "MD033": false,
    "MD041": false,
    "MD045": false
  }
}
```

| Rule    | Name                 | Why it is off by default                                                                         |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `MD013` | line-length          | Line width is a prose-wrapping decision; use `proseWrap` instead of a hard limit.                |
| `MD018` | no-missing-space-atx | `#roadmap` is a valid Obsidian tag, not a broken heading; the fix would turn tags into headings. |
| `MD033` | no-inline-html       | Obsidian notes routinely embed HTML (`<br>`, `<sup>`, callout markup).                           |
| `MD041` | first-line-heading   | Obsidian notes start with a Properties/frontmatter block, not a heading.                         |
| `MD045` | no-alt-text          | Missing image alt text is common in personal notes; the fix only inserts an empty placeholder.   |

`#word` at the start of a line is ambiguous: Obsidian renders it as a tag, markdownlint
reads it as a heading missing its space. The plugin sides with Obsidian — `obsidianSyntax.tags: preserve`
(the default) protects the token and `MD018` stays off. Set `"MD018": true` (and, if you use
`format` for tags, only then) if your vault never starts a line with a tag and you want
`#Heading` corrected to `# Heading`.

### Rules disabled dynamically by preservation choices

When a structure is set to `preserve`, the markdownlint rules that would rewrite that
same structure are switched off for that run so Prettier's `prettier-ignore` shields
and markdownlint do not fight each other:

| Setting                                         | Rules disabled while `preserve`                 |
| ----------------------------------------------- | ----------------------------------------------- |
| `markdownStructures.tables`                     | MD055, MD056, MD058, MD060                      |
| `markdownStructures.lists`                      | MD004, MD005, MD006, MD007, MD029, MD030, MD032 |
| `markdownStructures.fencedCodeBlocks` (default) | MD031, MD040, MD046, MD048                      |
| `markdownStructures.blockquotes`                | MD027, MD028                                    |
| `markdownStructures.horizontalRules`            | MD035                                           |
| `links.markdownLinks`                           | MD039, MD054                                    |
| `links.referenceDefinitions` (default)          | MD053, MD054                                    |
| `links.autolinks` (default)                     | MD034                                           |
| `obsidianSyntax.properties` (default)           | MD041                                           |
| `obsidianSyntax.callouts` (default)             | MD027, MD028                                    |

Set `runMarkdownlintFixes` to `false` to skip the markdownlint pass entirely and let
Prettier be the only formatter.

## JSON Schema

The repository contains `.markdown-formatter.schema.json` and `.markdown-formatter.example.json`. Editors with JSON Schema support can use the schema to validate project configuration before Obsidian loads it.

## Formatting exclusions

The preferred exclusion mechanism is `.markdown-formatter-ignore` at the vault root. It is shared by the Obsidian plugin and standalone CLI, so an ignored note cannot be formatted accidentally through a different trigger.

```text
# comments and blank lines are ignored
Templates/**
Archive/**/*.md
*.generated.md
!important.generated.md
```

Patterns are processed from top to bottom. `*` matches within one path segment, `**` can cross directories, `?` matches one character, `/name.md` anchors a pattern at the vault root, and `!` re-includes a path matched by an earlier pattern.

The default ignore-file path or extra inline patterns can be configured with:

```json
{
  "ignore": {
    "file": ".markdown-formatter-ignore",
    "patterns": ["Scratch/**", "*.generated.md"]
  }
}
```

Inline patterns are applied before patterns from the ignore file. The ignore policy applies to continuous formatting, format-on-open, format-on-close, manual command/hotkey/ribbon formatting, and standalone `check`/`format`.

## Standalone CLI

The CLI reads the same file. Obsidian-only keys — `formatOnModify`, `formatOnOpen`, `formatOnClose`, `showRibbonButton`, `debounceMs`, `stampUpdatedProperty`, `updatedProperty` — are accepted but ignored; everything else behaves identically. See the [command-line tool guide](CLI-GUIDE.md).

## Invalid or broken configuration

The formatter is intentionally fail-safe. A malformed `.markdown-formatter.json`, an unsafe project-relative path, or an ignore file that exists but cannot be read **disables formatting in the Obsidian plugin until the problem is fixed and reloaded**. The plugin logs the underlying error and shows a user-facing notice instead of silently falling back to settings that could rewrite files unexpectedly.

The standalone CLI treats invalid configuration as an operational error and exits with code `2`. Individual Markdown read/format/write failures are collected where possible so one bad file does not hide failures in the rest of the vault.

Project configuration rejects unknown top-level/nested keys to catch misspellings early. Persisted Obsidian UI settings are sanitized on load and invalid values fall back to conservative defaults.
