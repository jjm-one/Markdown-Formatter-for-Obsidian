// SPDX-License-Identifier: LGPL-3.0-only
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { createFakeApp, effective } from "./helpers";
import {
  addPreserveDirectives,
  extractProtectedFrontmatter,
  markdownlintConfigForPreservation,
  protectInlineLinks,
  protectObsidianSyntax,
  removePreserveDirectives,
} from "../src/core";

// `.txt`, not `.md`, so no Markdown formatter collapses the deliberate irregular
// spacing this fixture exists to protect (e.g. `%% Keep   comment spacing. %%`).
const fixture = fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/obsidian/all-syntax.txt"),
  "utf8",
);

function privatePlugin(plugin: unknown): any {
  return plugin as any;
}

describe("Obsidian syntax preservation", () => {
  it("fixture keeps its deliberate irregular spacing (guard against reformatting)", () => {
    expect(fixture).toContain("%% Keep   comment spacing exactly. %%");
    expect(fixture).toContain("Inline math $a  +  b = c$.");
    expect(fixture).toContain("a   &= b + c");
  });

  it("preserves frontmatter byte-for-byte", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin));
    const result = extractProtectedFrontmatter(fixture, e);
    expect(result.content.startsWith("# Obsidian")).toBe(true);
    expect(result.restore(result.content)).toBe(fixture);
  });

  it("protects and restores all inline Obsidian extensions", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin));
    const front = extractProtectedFrontmatter(fixture, e);
    const protectedResult = protectObsidianSyntax(front.content, e);
    expect(protectedResult.content).not.toContain("%% Keep");
    expect(protectedResult.content).not.toContain("==keep highlighted text==");
    expect(protectedResult.content).not.toContain("$a  +  b = c$");
    expect(protectedResult.content).not.toContain("^[keep inline footnote]");
    expect(protectedResult.content).not.toContain("^keep-this-id");
    expect(protectedResult.content).not.toContain("#project/backend");
    expect(protectedResult.restore(protectedResult.content)).toBe(front.content);
  });

  it("protects wikilinks, embeds and autolinks exactly", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin));
    const input = "[[Note#Heading|Alias]] ![[image.png|300]] <https://example.com/a?x=1&y=2>";
    const result = protectInlineLinks(input, e);
    expect(result.content).not.toContain("[[Note");
    expect(result.content).not.toContain("<https://");
    expect(result.restore(result.content)).toBe(input);
  });

  it("can preserve standard Markdown links when configured", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin), { links: { markdownLinks: "preserve" } });
    const input = "[a link](https://example.com/a_(b)) and ![img](image.png)";
    const result = protectInlineLinks(input, e);
    expect(result.content).toContain("MDFLINKTOKEN");
    expect(result.restore(result.content)).toBe(input);
  });

  it("protects a link whose destination contains balanced parentheses as a single token", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin), { links: { markdownLinks: "preserve" } });
    const input = "See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) for details.";
    const result = protectInlineLinks(input, e);
    // A single token with no stray ")" left outside it means the whole
    // destination, parentheses included, was captured in one match.
    expect(result.content).toMatch(/^See MDFLINKTOKEN\d+X for details\.$/);
    expect(result.restore(result.content)).toBe(input);
  });

  it("adds and removes preservation directives for protected block structures", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin), {
      markdownStructures: {
        tables: "preserve",
        lists: "preserve",
        fencedCodeBlocks: "preserve",
        blockquotes: "preserve",
        horizontalRules: "preserve",
      },
    });
    const input = [
      "|A|B|",
      "|-|-|",
      "|1|2|",
      "",
      "* item",
      "",
      "> quote",
      "",
      "---",
      "",
      "```js",
      "x(  1 )",
      "```",
    ].join("\n");
    const shielded = addPreserveDirectives(input, e);
    expect(shielded.match(/prettier-ignore/g)?.length).toBeGreaterThanOrEqual(5);
    expect(removePreserveDirectives(shielded)).toBe(input);
  });

  it("disables markdownlint rules that conflict with preservation choices", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin), {
      markdownStructures: {
        tables: "preserve",
        lists: "preserve",
        blockquotes: "preserve",
        horizontalRules: "preserve",
      },
      links: { markdownLinks: "preserve", referenceDefinitions: "preserve", autolinks: "preserve" },
    });
    const cfg = markdownlintConfigForPreservation(e);
    for (const rule of [
      "MD055",
      "MD056",
      "MD058",
      "MD060",
      "MD004",
      "MD007",
      "MD029",
      "MD035",
      "MD039",
      "MD053",
      "MD054",
      "MD034",
    ]) {
      expect(cfg[rule]).toBe(false);
    }
  });

  it("does not mistake heading markers for Obsidian tags", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin));
    const input = "# Heading\nText #real/tag";
    const result = protectObsidianSyntax(input, e);
    expect(result.content).toContain("# Heading");
    expect(result.content).not.toContain("#real/tag");
    expect(result.restore(result.content)).toBe(input);
  });

  it("preserves a full Obsidian fixture through formatFile", async () => {
    const file = new TFile("fixture.md");
    const { plugin, files } = createFakeApp({ files: { "fixture.md": fixture } });
    await plugin.loadSettings();
    await plugin.formatFile(file, false);
    const formatted = files.get("fixture.md")!;
    for (const token of [
      'aliases:\n  - "Exact Alias"',
      "[[Internal Note#Heading|Alias]]",
      "![[image.png|300]]",
      "> [!warning]- Keep fold state",
      "^keep-this-id",
      "%% Keep   comment spacing exactly. %%",
      "#project/backend",
      "==keep highlighted text==",
      "^[keep inline footnote]",
      "$a  +  b = c$",
      // The display-math delimiters must round-trip intact: String.replaceAll
      // treats "$$" in a plain-string replacement as a special pattern, so a
      // naive restore silently collapses "$$" to "$" (regression coverage).
      "$$\n\\\\begin{aligned}",
      "\\\\end{aligned}\n$$",
      "```mermaid\ngraph TD\n    A --> B\n```",
    ])
      expect(formatted).toContain(token);
  });

  it("round-trips display math delimiters through protect/restore without collapsing $$ to $", () => {
    const { plugin } = createFakeApp();
    const e = effective(privatePlugin(plugin));
    const input = "Before.\n\n$$\na + b = c\n$$\n\nAfter.\n";
    const result = protectObsidianSyntax(input, e);
    expect(result.content).not.toContain("$$");
    expect(result.restore(result.content)).toBe(input);
  });

  it("disables MD018 by default so a tag-shaped line is not rewritten into a heading", async () => {
    const file = new TFile("tag.md");
    const { plugin, files } = createFakeApp({ files: { "tag.md": "#roadmap\n" } });
    await plugin.loadSettings();
    await plugin.formatFile(file, false);
    expect(files.get("tag.md")).toBe("#roadmap\n");
  });

  it("still fixes missing-space-atx headings when MD018 is explicitly re-enabled and tags are not preserved", async () => {
    const file = new TFile("heading.md");
    const { plugin, files } = createFakeApp({ files: { "heading.md": "#Heading\n" } });
    await plugin.loadSettings();
    plugin.settings.obsidianSyntax.tags = "format";
    plugin.settings.markdownlintConfigJson = JSON.stringify({
      ...JSON.parse(plugin.settings.markdownlintConfigJson),
      MD018: true,
    });
    await plugin.formatFile(file, false);
    expect(files.get("heading.md")).toBe("# Heading\n");
  });
});
