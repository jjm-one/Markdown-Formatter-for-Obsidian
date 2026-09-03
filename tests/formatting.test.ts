// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createFakeApp } from "./helpers";
import { effectiveSettingsFromProject, resolvePrettierOptions } from "../src/core";

describe("formatting pipeline", () => {
  it("rewrites a compact GFM table by default", async () => {
    const file = new TFile("table.md");
    const { plugin, files } = createFakeApp({
      files: { "table.md": "|Name|Value|\n|-|-|\n|foo|123|\n" },
    });
    await plugin.loadSettings();
    await plugin.formatFile(file, false);
    expect(files.get("table.md")).toContain("| Name");
    expect(files.get("table.md")).toContain("| ---");
  });

  it("preserves table source when table mode is preserve", async () => {
    const original = "|Name|Value|\n|-|-|\n|foo|123|\n";
    const file = new TFile("table.md");
    const { plugin, files } = createFakeApp({ files: { "table.md": original } });
    await plugin.loadSettings();
    plugin.settings.markdownStructures.tables = "preserve";
    plugin.settings.runMarkdownlintFixes = false;
    await plugin.formatFile(file, false);
    expect(files.get("table.md")).toContain(original.trim());
  });

  it("does not write when formatting is already stable", async () => {
    const file = new TFile("stable.md");
    const original = "# Stable\n\nText.\n";
    const { plugin, app } = createFakeApp({ files: { "stable.md": original } });
    await plugin.loadSettings();
    const spy = vi.spyOn(app.vault, "modify");
    await plugin.formatFile(file, false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prevents re-entrant formatting of the same file", async () => {
    const file = new TFile("same.md");
    const { plugin, app } = createFakeApp({ files: { "same.md": "# x\n" } });
    await plugin.loadSettings();
    (plugin as any).formatting.add(file.path);
    const spy = vi.spyOn(app.vault, "read");
    await plugin.formatFile(file, false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("forces the Markdown parser and target filepath in the shared core", async () => {
    const effective = effectiveSettingsFromProject({ usePrettierConfig: false });
    const options = await resolvePrettierOptions("/vault/folder/note.md", effective);
    expect(options.parser).toBe("markdown");
    expect(options.filepath).toBe("/vault/folder/note.md");
    expect(options.proseWrap).toBe("preserve");
  });
});
