// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { setFrontmatterProperty } from "../src/core";

describe("setFrontmatterProperty", () => {
  it("updates an existing top-level scalar and leaves the rest byte-for-byte", () => {
    const input = "---\ntitle: Note\nupdated: 2024-01-01\ntags: [a, b]\n---\n\n# Body\n";
    expect(setFrontmatterProperty(input, "updated", "2026-09-03")).toBe(
      "---\ntitle: Note\nupdated: 2026-09-03\ntags: [a, b]\n---\n\n# Body\n",
    );
  });

  it("returns null when the property is absent (it is never added)", () => {
    expect(
      setFrontmatterProperty("---\ntitle: Note\n---\n\nBody\n", "updated", "2026-09-03"),
    ).toBeNull();
  });

  it("returns null when there is no frontmatter", () => {
    expect(setFrontmatterProperty("# Just a heading\n", "updated", "2026-09-03")).toBeNull();
  });

  it("returns null when the value is already current", () => {
    expect(
      setFrontmatterProperty("---\nupdated: 2026-09-03\n---\n", "updated", "2026-09-03"),
    ).toBeNull();
  });

  it("keeps quoted keys and keys with spaces", () => {
    expect(
      setFrontmatterProperty('---\n"Last Update": 2024-01-01\n---\n', "Last Update", "2026-09-03"),
    ).toBe("---\nLast Update: 2026-09-03\n---\n");
  });

  it("ignores a nested key of the same name", () => {
    const input = "---\nmeta:\n  updated: 2024-01-01\n---\n";
    expect(setFrontmatterProperty(input, "updated", "2026-09-03")).toBeNull();
  });

  it("does not match a key that is only a prefix of another", () => {
    expect(
      setFrontmatterProperty("---\nupdated_by: me\n---\n", "updated", "2026-09-03"),
    ).toBeNull();
  });

  it("quotes a value that would be ambiguous YAML (contains a colon)", () => {
    expect(setFrontmatterProperty("---\nupdated: x\n---\n", "updated", "2026-09-03 14:30")).toBe(
      '---\nupdated: "2026-09-03 14:30"\n---\n',
    );
  });

  it("handles frontmatter without a trailing newline", () => {
    expect(setFrontmatterProperty("---\nupdated: old\n---", "updated", "2026-09-03")).toBe(
      "---\nupdated: 2026-09-03\n---",
    );
  });
});
