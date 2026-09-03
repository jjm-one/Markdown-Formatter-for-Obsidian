// SPDX-License-Identifier: LGPL-3.0-only
// Verify the schema, example config, and source defaults still preserve Obsidian-sensitive syntax.
import fs from "node:fs";

const source = fs.readFileSync("src/core/config.ts", "utf8");
const example = JSON.parse(fs.readFileSync(".markdown-formatter.example.json", "utf8"));
const schema = JSON.parse(fs.readFileSync(".markdown-formatter.schema.json", "utf8"));

const protectedKeys = [
  "properties",
  "callouts",
  "blockIds",
  "comments",
  "math",
  "tags",
  "inlineFootnotes",
  "highlights",
];

for (const key of protectedKeys) {
  if (example.obsidianSyntax?.[key] !== "preserve") {
    throw new Error(`Example config must preserve obsidianSyntax.${key} by default.`);
  }
  if (!schema.properties?.obsidianSyntax?.properties?.[key]) {
    throw new Error(`Schema is missing obsidianSyntax.${key}.`);
  }
  if (!source.includes(`${key}: "preserve"`)) {
    throw new Error(`Source defaults do not preserve obsidianSyntax.${key}.`);
  }
}

if (example.links?.obsidianWikilinks !== "preserve") {
  throw new Error("Obsidian wikilinks/embeds must be preserved by default.");
}
if (example.markdownStructures?.fencedCodeBlocks !== "preserve") {
  throw new Error("Fenced code blocks must be preserved by default for Obsidian compatibility.");
}

console.log("Obsidian compatibility defaults are present and conservative.");
