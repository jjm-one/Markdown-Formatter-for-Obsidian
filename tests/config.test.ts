// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createFakeApp } from "./helpers";
import fs from "node:fs";
import {
  DEFAULT_PROJECT_CONFIG,
  effectiveSettingsFromProject,
  safeProjectPrettierOptions,
  validateProjectConfig,
} from "../src/core";

function p(plugin: any) {
  return plugin;
}

describe("configuration", () => {
  it("sanitizes persisted nested settings with safe defaults", async () => {
    const { plugin } = createFakeApp();
    (plugin as any).loadData = async () =>
      await Promise.resolve({
        formatOnOpen: true,
        links: { markdownLinks: "preserve" },
        obsidianSyntax: { math: "format" },
        markdownStructures: { tables: "preserve" },
      });
    await plugin.loadSettings();
    expect(plugin.settings.formatOnOpen).toBe(true);
    expect(plugin.settings.links.markdownLinks).toBe("preserve");
    expect(plugin.settings.links.obsidianWikilinks).toBe("preserve");
    expect(plugin.settings.obsidianSyntax.math).toBe("format");
    expect(plugin.settings.obsidianSyntax.comments).toBe("preserve");
    expect(plugin.settings.markdownStructures.tables).toBe("preserve");
    expect(plugin.settings.markdownStructures.fencedCodeBlocks).toBe("preserve");
  });

  it("project config overrides UI settings and merges markdownlint rules", async () => {
    const { plugin } = createFakeApp({
      files: {
        ".markdown-formatter.json": JSON.stringify({
          formatOnOpen: true,
          proseWrap: "never",
          markdownStructures: { tables: "preserve" },
          markdownlint: { MD013: true, MD007: false },
        }),
      },
    });
    await plugin.loadSettings();
    await plugin.loadProjectConfig(false);
    const e = p(plugin).getEffectiveSettings();
    expect(e.formatOnOpen).toBe(true);
    expect(e.proseWrap).toBe("never");
    expect(e.markdownStructures.tables).toBe("preserve");
    expect(e.markdownStructures.fencedCodeBlocks).toBe("preserve");
    expect(e.markdownlint.MD013).toBe(true);
    expect(e.markdownlint.MD007).toBe(false);
    expect(e.markdownlint.MD033).toBe(false);
  });

  it("removes unsafe project-controlled Prettier options", () => {
    const result = safeProjectPrettierOptions({
      parser: "babel",
      filepath: "/tmp/x",
      plugins: ["evil"],
      printWidth: 88,
      tabWidth: 4,
    });
    expect(result).toEqual({ printWidth: 88, tabWidth: 4 });
  });

  it.each([
    [{ debounceMs: 249 }, "debounceMs"],
    [{ proseWrap: "sometimes" }, "proseWrap"],
    [{ markdownStructures: { tables: "unknown" } }, "markdownStructures.tables"],
    [{ markdownStructures: { mystery: "preserve" } }, "Unknown markdownStructures"],
    [{ links: { obsidianWikilinks: "unknown" } }, "links.obsidianWikilinks"],
    [{ links: { mystery: "preserve" } }, "Unknown links"],
    [{ obsidianSyntax: { comments: "unknown" } }, "obsidianSyntax.comments"],
    [{ obsidianSyntax: { mystery: "preserve" } }, "Unknown obsidianSyntax"],
    [{ markdownlint: null }, "markdownlint"],
    [{ prettier: null }, "prettier"],
    [{ ignore: null }, "ignore"],
    [{ ignore: { file: "" } }, "ignore.file"],
    [{ ignore: { patterns: "Templates/**" } }, "ignore.patterns"],
    [{ ignore: { patterns: [""] } }, "ignore.patterns"],
    [null, "JSON object"],
    [[], "JSON object"],
    [{ formatOnOpen: "yes" }, "formatOnOpen"],
    [{ debounceMs: 700000 }, "debounceMs"],
    [{ stampUpdatedProperty: "yes" }, "stampUpdatedProperty"],
    [{ updatedProperty: "bad:name" }, "updatedProperty"],
    [{ updatedProperty: 3 }, "updatedProperty"],
    [{ ignore: { unknown: true } }, "Unknown ignore"],
    [{ ignore: { file: "../outside.ignore" } }, "ignore.file"],
    [{ unexpectedTypo: true }, "Unknown project configuration"],
  ])("rejects invalid project config %#", (config, message) => {
    expect(() => validateProjectConfig(config)).toThrow(message);
  });

  it("exposes every plugin setting through the config file, schema, and defaults", () => {
    const schema = JSON.parse(fs.readFileSync(".markdown-formatter.schema.json", "utf8")) as {
      properties: Record<string, unknown>;
    };
    const example = JSON.parse(
      fs.readFileSync(".markdown-formatter.example.json", "utf8"),
    ) as Record<string, unknown>;

    const drop$schema = (keys: string[]) => keys.filter((key) => key !== "$schema").sort();
    const defaultKeys = drop$schema(Object.keys(DEFAULT_PROJECT_CONFIG));

    expect(drop$schema(Object.keys(schema.properties))).toEqual(defaultKeys);
    expect(drop$schema(Object.keys(example))).toEqual(defaultKeys);
    // Every documented key is accepted by the validator.
    expect(() => validateProjectConfig(example)).not.toThrow();
    expect(() => validateProjectConfig(DEFAULT_PROJECT_CONFIG)).not.toThrow();
  });

  it("threads the updated-date policy from the config file into effective settings", () => {
    const effective = effectiveSettingsFromProject({
      stampUpdatedProperty: true,
      updatedProperty: "Last Update",
    });
    expect(effective.stampUpdatedProperty).toBe(true);
    expect(effective.updatedProperty).toBe("Last Update");
    // Defaults when unset.
    const bare = effectiveSettingsFromProject(null);
    expect(bare.stampUpdatedProperty).toBe(false);
    expect(bare.updatedProperty).toBe("updated");
  });

  it("falls back to default markdownlint when UI JSON is invalid", () => {
    const { plugin } = createFakeApp();
    plugin.settings.markdownlintConfigJson = "{bad";
    const cfg = p(plugin).parseUiMarkdownlintConfig();
    expect(cfg.default).toBe(true);
    expect(cfg.MD013).toBe(false);
  });

  it("creates a complete default project configuration", async () => {
    const { plugin, files } = createFakeApp();
    await plugin.loadSettings();
    await plugin.createProjectConfig();
    const parsed = JSON.parse(files.get(".markdown-formatter.json")!);
    expect(parsed.obsidianSyntax.properties).toBe("preserve");
    expect(parsed.links.obsidianWikilinks).toBe("preserve");
    expect(parsed.markdownStructures.fencedCodeBlocks).toBe("preserve");
    expect(parsed.ignore.file).toBe(".markdown-formatter-ignore");
    expect(parsed.ignore.patterns).toEqual([]);
  });

  it("sanitizes corrupted persisted plugin settings instead of trusting them", async () => {
    const { plugin } = createFakeApp();
    (plugin as any).loadData = async () =>
      await Promise.resolve({
        formatOnOpen: "yes",
        debounceMs: -1,
        projectConfigPath: "../outside.json",
        proseWrap: "sometimes",
        markdownStructures: { tables: "explode" },
        links: [],
      });
    await plugin.loadSettings();
    expect(plugin.settings.formatOnOpen).toBe(false);
    expect(plugin.settings.debounceMs).toBe(900);
    expect(plugin.settings.projectConfigPath).toBe(".markdown-formatter.json");
    expect(plugin.settings.proseWrap).toBe("preserve");
    expect(plugin.settings.markdownStructures.tables).toBe("prettier");
    expect(plugin.settings.links.obsidianWikilinks).toBe("preserve");
  });
});
