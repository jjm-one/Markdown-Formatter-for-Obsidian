// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createIgnoreMatcher, isPathIgnored, parseIgnorePatterns } from "../src/core";

describe("formatting exclusions", () => {
  it("parses comments and blank lines from the ignore file", () => {
    expect(parseIgnorePatterns("# comment\n\nTemplates/**\n  *.generated.md  \n")).toEqual([
      "Templates/**",
      "*.generated.md",
    ]);
  });

  it("rejects ignore files that exceed the safety limits", () => {
    expect(() => parseIgnorePatterns("x".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
    expect(() =>
      parseIgnorePatterns(Array.from({ length: 10001 }, (_, i) => `f${i}.md`).join("\n")),
    ).toThrow("10000 patterns");
    expect(() => parseIgnorePatterns(`${"a".repeat(4097)}.md`)).toThrow("4096 characters");
  });

  it("treats a root-anchored directory pattern as everything under that top-level folder", () => {
    expect(isPathIgnored("Templates/note.md", ["/Templates/"])).toBe(true);
    expect(isPathIgnored("Templates", ["/Templates/"])).toBe(true);
    expect(isPathIgnored("Sub/Templates/note.md", ["/Templates/"])).toBe(false);
  });

  it("does not treat a directory pattern as a name prefix (Templates/ vs TemplatesFoo)", () => {
    expect(isPathIgnored("TemplatesFoo.md", ["Templates/"])).toBe(false);
    expect(isPathIgnored("TemplatesArchive/x.md", ["Templates/"])).toBe(false);
    expect(isPathIgnored("Notes/Templates/x.md", ["Templates/"])).toBe(true);
  });

  it.each([
    ["Templates/daily.md", ["Templates/**"], true],
    ["Archive/2026/january.md", ["Archive/**/*.md"], true],
    ["Notes/foo.generated.md", ["*.generated.md"], true],
    ["private-note.md", ["private-note.md"], true],
    ["Notes/private-note.md", ["/private-note.md"], false],
    ["private-note.md", ["/private-note.md"], true],
    ["Notes/keep.md", ["Notes/**", "!Notes/keep.md"], false],
    ["Notes/drop.md", ["Notes/**", "!Notes/keep.md"], true],
    ["Notes/a1.md", ["Notes/a?.md"], true],
  ])("matches %s against %j", (path, patterns, expected) => {
    expect(isPathIgnored(path, patterns)).toBe(expected);
  });

  it("compiles patterns once and reuses them across matches (createIgnoreMatcher)", () => {
    const matcher = createIgnoreMatcher([
      "Templates/**",
      "*.generated.md",
      "!important.generated.md",
    ]);
    expect(matcher.matches("Templates/daily.md")).toBe(true);
    expect(matcher.matches("drop.generated.md")).toBe(true);
    expect(matcher.matches("important.generated.md")).toBe(false);
    expect(matcher.matches("keep.md")).toBe(false);
    // isPathIgnored delegates to the same matcher and must agree with it.
    for (const path of [
      "Templates/daily.md",
      "drop.generated.md",
      "important.generated.md",
      "keep.md",
    ]) {
      expect(
        isPathIgnored(path, ["Templates/**", "*.generated.md", "!important.generated.md"]),
      ).toBe(matcher.matches(path));
    }
  });
});
