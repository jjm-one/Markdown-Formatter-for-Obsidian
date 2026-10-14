// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createFakeApp } from "./helpers";
import fs from "node:fs";
import {
  DEFAULT_SETTINGS,
  effectiveSettingsFromProject,
  projectConfigFromSettings,
  safeProjectPrettierOptions,
  validateProjectConfig,
  validateProjectSetting,
} from "../src/core";

function p(plugin: any) {
  return plugin;
}

type Schema = {
  properties: Record<string, { properties?: Record<string, { enum?: string[] }> }>;
};
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

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

  it("merges a project config over a custom base, key by key", () => {
    const base = {
      ...DEFAULT_SETTINGS,
      proseWrap: "always" as const,
      links: { ...DEFAULT_SETTINGS.links, autolinks: "prettier" as const },
    };
    const merged = effectiveSettingsFromProject(
      { links: { markdownLinks: "preserve" }, debounceMs: undefined },
      base,
    );
    expect(merged.proseWrap).toBe("always");
    expect(merged.links).toEqual({ ...base.links, markdownLinks: "preserve" });
    expect(merged.debounceMs).toBe(DEFAULT_SETTINGS.debounceMs); // undefined never overrides
    expect(merged.links).not.toBe(base.links); // nested settings are fresh objects
    expect(effectiveSettingsFromProject(null, base).links).not.toBe(base.links);
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
    expect(
      effectiveSettingsFromProject({ prettier: { plugins: ["evil"], tabWidth: 4 } }).prettier,
    ).toEqual({ tabWidth: 4 });
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
    [{ trustPrettierConfig: true }, "Unknown project configuration"],
    [{ toString: true }, "Unknown project configuration"],
  ])("rejects invalid project config %#", (config, message) => {
    expect(() => validateProjectConfig(config)).toThrow(message);
  });

  it("validates single settings by flat or dotted key", () => {
    expect(() => validateProjectSetting("proseWrap", "never")).not.toThrow();
    expect(() => validateProjectSetting("links.autolinks", "prettier")).not.toThrow();
    expect(() => validateProjectSetting("links.autolinks", "format")).toThrow("links.autolinks");
    expect(() => validateProjectSetting("__proto__.polluted", true)).toThrow("Unknown");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps the schema, example config, and defaults describing the same settings", () => {
    const schema = readJson(".markdown-formatter.schema.json") as Schema;
    const example = readJson(".markdown-formatter.example.json") as Record<string, unknown>;

    const keys = (value: object) =>
      Object.keys(value)
        .filter((key) => key !== "$schema")
        .sort();
    const defaultKeys = keys(DEFAULT_SETTINGS);
    expect(keys(schema.properties)).toEqual(defaultKeys);
    expect(keys(example)).toEqual(defaultKeys);
    for (const group of ["markdownStructures", "links", "obsidianSyntax", "ignore"] as const) {
      expect(keys(schema.properties[group]?.properties ?? {})).toEqual(
        keys(DEFAULT_SETTINGS[group]),
      );
    }
    // Every documented key is accepted by the validator.
    expect(() => validateProjectConfig(example)).not.toThrow();
    expect(() => validateProjectConfig(projectConfigFromSettings(DEFAULT_SETTINGS))).not.toThrow();
  });

  it("preserves every Obsidian-sensitive construct by default (defaults, example, and schema)", () => {
    const schema = readJson(".markdown-formatter.schema.json") as Schema;
    const example = readJson(".markdown-formatter.example.json") as {
      obsidianSyntax: Record<string, string>;
      links: Record<string, string>;
      markdownStructures: Record<string, string>;
    };
    for (const [key, mode] of Object.entries(DEFAULT_SETTINGS.obsidianSyntax)) {
      expect(mode, `default obsidianSyntax.${key}`).toBe("preserve");
      expect(example.obsidianSyntax[key], `example obsidianSyntax.${key}`).toBe("preserve");
      expect(schema.properties.obsidianSyntax?.properties?.[key]?.enum).toContain("preserve");
    }
    for (const settings of [DEFAULT_SETTINGS, example]) {
      expect(settings.links.obsidianWikilinks).toBe("preserve");
      expect(settings.markdownStructures.fencedCodeBlocks).toBe("preserve");
    }
  });

  it("keeps the defaults immutable", () => {
    expect(() => {
      (DEFAULT_SETTINGS.links as Record<string, string>).autolinks = "prettier";
    }).toThrow();
    expect(DEFAULT_SETTINGS.links.autolinks).toBe("preserve");
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
    plugin.settings.markdownlintConfigJson = "[1]";
    expect(p(plugin).parseUiMarkdownlintConfig().default).toBe(true);
  });

  it("creates a complete default project configuration", async () => {
    const { plugin, files } = createFakeApp();
    await plugin.loadSettings();
    await plugin.createProjectConfig();
    const parsed = JSON.parse(files.get(".markdown-formatter.json")!);
    expect(parsed.$schema).toContain(".markdown-formatter.schema.json");
    expect(parsed.obsidianSyntax.properties).toBe("preserve");
    expect(parsed.links.obsidianWikilinks).toBe("preserve");
    expect(parsed.markdownStructures.fencedCodeBlocks).toBe("preserve");
    expect(parsed.ignore.file).toBe(".markdown-formatter-ignore");
    expect(parsed.ignore.patterns).toEqual([]);
    expect(parsed.trustPrettierConfig).toBeUndefined(); // plugin-only
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
        trustPrettierConfig: "yes",
        updatedProperty: "  Last Update  ",
      });
    await plugin.loadSettings();
    expect(plugin.settings.formatOnOpen).toBe(false);
    expect(plugin.settings.debounceMs).toBe(900);
    expect(plugin.settings.projectConfigPath).toBe(".markdown-formatter.json");
    expect(plugin.settings.proseWrap).toBe("preserve");
    expect(plugin.settings.markdownStructures.tables).toBe("prettier");
    expect(plugin.settings.links.obsidianWikilinks).toBe("preserve");
    expect(plugin.settings.trustPrettierConfig).toBe(false);
    expect(plugin.settings.updatedProperty).toBe("Last Update");
  });
});
