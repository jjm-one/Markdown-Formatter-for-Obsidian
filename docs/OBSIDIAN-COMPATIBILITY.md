# Obsidian compatibility

> For how to turn these protections on or off from the settings tab, see the **[Obsidian plugin guide](PLUGIN-GUIDE.md#obsidian-compatibility)**.

Generic Markdown formatters do not understand every Obsidian extension. This plugin therefore uses conservative defaults and a protection layer around syntax that can carry Obsidian-specific semantics.

## Preserved by default

- YAML Properties/frontmatter.
- `[[wikilinks]]` and `![[embeds]]`.
- Callouts, including fold markers such as `[!note]-` and `[!note]+`.
- Block IDs and block references.
- `%%comments%%`.
- Inline and block MathJax.
- Obsidian tags.
- Inline footnotes.
- `==highlights==`.
- Fenced code blocks, including Mermaid and plugin-specific fenced languages.
- Reference definitions and angle-bracket autolinks.

Properties/frontmatter is removed from the generic formatting pass and reattached unchanged. Other protected blocks/tokens are shielded while Prettier and markdownlint process surrounding Markdown.

## Why fenced code defaults to preserve

Prettier can format languages embedded inside Markdown fences. In Obsidian those fences may contain Mermaid, Dataview/plugin languages, or source whose exact representation matters. Preserving the complete fence is safer than assuming the language is ordinary source code.

## Generic Markdown still formats normally

Standard paragraphs, headings, normal Markdown links, tables, lists, blockquotes, and horizontal rules can still be normalized unless their corresponding preservation option is enabled.

## markdownlint and Obsidian

The markdownlint pass runs after Prettier and only applies fixes from enabled rules. Some rules are off by default so markdownlint does not "correct" valid Obsidian syntax — notably `MD018` (a leading `#roadmap` is a tag, not a broken heading), plus `MD013`, `MD033`, `MD041`, and `MD045`. Setting a structure or construct to `preserve` disables more rules for that run.

The full list and rationale: [Configuration → markdownlint](CONFIGURATION.md#markdownlint).

## Regression guard

`npm run check:obsidian` verifies that the project schema, example configuration, and source defaults continue to preserve the compatibility-sensitive constructs. CI runs this check for every push and pull request.
