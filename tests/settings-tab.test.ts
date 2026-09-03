// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createFakeApp } from "./helpers";

type Tab = {
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
  getSettingDefinitions(): unknown;
  saveMarkdownlintJson(value: string): Promise<void>;
  updateCount: number;
};

async function loadTab(files?: Record<string, string>) {
  const env = createFakeApp(files ? { files } : {});
  await env.plugin.onload();
  return { ...env, plugin: env.plugin, tab: (env.plugin as any).settingTabs[0] as Tab };
}

const CONFIG_PATH = ".markdown-formatter.json";
const readConfig = (files: Map<string, string>) => JSON.parse(files.get(CONFIG_PATH) ?? "{}");

describe("settings tab controls", () => {
  it("reads and writes dotted keys and persists them", async () => {
    const { plugin, tab } = await loadTab();
    expect(tab.getControlValue("markdownStructures.tables")).toBe("prettier");
    expect(tab.getControlValue("obsidianSyntax.math")).toBe("preserve");
    expect(tab.getControlValue("links.missing")).toBeUndefined();

    await tab.setControlValue("markdownStructures.tables", "preserve");
    expect(plugin.settings.markdownStructures.tables).toBe("preserve");
    expect(tab.getControlValue("markdownStructures.tables")).toBe("preserve");
    expect((plugin as any).data.markdownStructures.tables).toBe("preserve");
  });

  it("clamps and rounds the debounce value", async () => {
    const { plugin, tab } = await loadTab();
    await tab.setControlValue("debounceMs", 5);
    expect(plugin.settings.debounceMs).toBe(250);
    await tab.setControlValue("debounceMs", 10_000_000);
    expect(plugin.settings.debounceMs).toBe(600_000);
    await tab.setControlValue("debounceMs", 812.6);
    expect(plugin.settings.debounceMs).toBe(813);
  });

  it("rejects invalid values and leaves the setting untouched", async () => {
    const { plugin, tab } = await loadTab();
    await expect(tab.setControlValue("proseWrap", "sometimes")).rejects.toThrow("prose wrapping");
    await expect(tab.setControlValue("formatOnModify", "yes")).rejects.toThrow("true or false");
    await expect(tab.setControlValue("markdownStructures.tables", "nope")).rejects.toThrow(
      "Markdown structure mode",
    );
    await expect(tab.setControlValue("obsidianSyntax.math", "nope")).rejects.toThrow(
      "Obsidian syntax mode",
    );
    await expect(tab.setControlValue("debounceMs", Number.NaN)).rejects.toThrow("finite number");
    await expect(tab.setControlValue("projectConfigPath", "../escape.json")).rejects.toThrow(
      "vault-relative",
    );
    await expect(tab.setControlValue("unknownKey", true)).rejects.toThrow("Unknown plugin setting");
    expect(plugin.settings.proseWrap).toBe("preserve");
    expect(plugin.settings.formatOnModify).toBe(false);
  });

  it("does not pollute Object.prototype through a crafted setting key", async () => {
    const { tab } = await loadTab();
    await expect(tab.setControlValue("__proto__.polluted", true)).rejects.toThrow();
    await expect(tab.setControlValue("constructor.prototype.polluted", true)).rejects.toThrow();
    expect(tab.getControlValue("__proto__.polluted")).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("re-applies side effects: save always, config reload and ribbon refresh conditionally", async () => {
    const { plugin, tab } = await loadTab();
    const save = vi.spyOn(plugin, "saveSettings");
    const reload = vi.spyOn(plugin, "loadProjectConfig").mockResolvedValue();
    const ribbon = vi.spyOn(plugin, "updateRibbonButton");

    await tab.setControlValue("proseWrap", "never");
    expect(save).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(ribbon).not.toHaveBeenCalled();

    await tab.setControlValue("useProjectConfig", false);
    expect(reload).toHaveBeenCalledTimes(1);

    await tab.setControlValue("showRibbonButton", false);
    expect(ribbon).toHaveBeenCalledTimes(1);
  });

  it("builds every setting group without a browser DOM", async () => {
    const { tab } = await loadTab();
    const groups = tab.getSettingDefinitions() as { heading: string; items: unknown[] }[];
    expect(groups.map((g) => g.heading)).toEqual(
      expect.arrayContaining([
        "Formatting triggers",
        "Note properties",
        "Obsidian compatibility",
        "Markdownlint",
      ]),
    );
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it("validates the updated-date property name and re-evaluates the field on toggle", async () => {
    const { plugin, tab } = await loadTab();
    await expect(tab.setControlValue("updatedProperty", "bad:name")).rejects.toThrow(
      "property name",
    );
    expect(plugin.settings.updatedProperty).toBe("updated");

    await tab.setControlValue("updatedProperty", "  Last Update  ");
    expect(plugin.settings.updatedProperty).toBe("Last Update");

    const before = (tab as unknown as { refreshDomStateCount: number }).refreshDomStateCount;
    await tab.setControlValue("stampUpdatedProperty", true);
    expect((tab as unknown as { refreshDomStateCount: number }).refreshDomStateCount).toBe(
      before + 1,
    );

    const propertyField = (tab.getSettingDefinitions() as { items: any[] }[])
      .flatMap((group) => group.items)
      .find((item) => item?.control?.key === "updatedProperty");
    expect(propertyField.control.disabled()).toBe(false);
  });
});

describe("settings tab with a vault project config file", () => {
  it("shows the file's values, falling back to plugin settings for keys it omits", async () => {
    const { tab } = await loadTab({ [CONFIG_PATH]: JSON.stringify({ proseWrap: "never" }) });
    expect(tab.getControlValue("proseWrap")).toBe("never"); // from the file
    expect(tab.getControlValue("formatOnModify")).toBe(false); // not in the file
    expect(tab.getControlValue("markdownStructures.tables")).toBe("prettier"); // not in the file
  });

  it("writes UI edits back to the file and leaves plugin settings untouched", async () => {
    const { plugin, tab, files } = await loadTab({
      [CONFIG_PATH]: JSON.stringify({ proseWrap: "never" }),
    });

    await tab.setControlValue("proseWrap", "always");
    await tab.setControlValue("formatOnOpen", true);
    await tab.setControlValue("markdownStructures.tables", "preserve");

    const written = readConfig(files);
    expect(written.proseWrap).toBe("always");
    expect(written.formatOnOpen).toBe(true);
    expect(written.markdownStructures.tables).toBe("preserve");
    expect(written.$schema).toContain(".markdown-formatter.schema.json");

    expect(plugin.settings.proseWrap).toBe("preserve");
    expect(plugin.settings.formatOnOpen).toBe(false);
    expect(tab.getControlValue("proseWrap")).toBe("always");
  });

  it("routes the markdownlint editor to the file too", async () => {
    const { tab, files } = await loadTab({ [CONFIG_PATH]: JSON.stringify({ proseWrap: "never" }) });
    await tab.saveMarkdownlintJson('{ "MD013": true }');
    expect(readConfig(files).markdownlint).toEqual({ MD013: true });
  });

  it("reflects an external edit to the file in the tab and effective settings", async () => {
    const env = await loadTab({ [CONFIG_PATH]: JSON.stringify({ proseWrap: "never" }) });
    const updatesBefore = env.tab.updateCount;

    env.files.set(CONFIG_PATH, JSON.stringify({ proseWrap: "always" }));
    await env.emitVault("modify", new TFile(CONFIG_PATH) as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(env.tab.getControlValue("proseWrap")).toBe("always");
    expect(env.tab.updateCount).toBeGreaterThan(updatesBefore);
  });

  it("does not reload on the echo of its own write", async () => {
    const env = await loadTab({ [CONFIG_PATH]: JSON.stringify({ proseWrap: "never" }) });
    const reload = vi.spyOn(env.plugin, "loadProjectConfig");

    await env.tab.setControlValue("proseWrap", "always");
    // Simulate the vault emitting the modify event for our own write.
    await env.emitVault("modify", new TFile(CONFIG_PATH) as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(readConfig(env.files).proseWrap).toBe("always");
    expect((env.plugin as any).projectConfig.proseWrap).toBe("always");
    // The echo is swallowed: no error state, value still correct.
    expect((env.plugin as any).projectConfigError).toBeNull();
    reload.mockRestore();
  });

  it("seeds a newly created file from the current settings, then edits it", async () => {
    const { plugin, tab, files } = await loadTab();
    await tab.setControlValue("proseWrap", "always"); // plugin settings (no file yet)
    await tab.setControlValue("formatOnOpen", true);

    const create = (plugin as any).commands.find(
      (c: any) => c.id === "create-project-configuration",
    );
    await create.callback();

    const seeded = readConfig(files);
    expect(seeded.proseWrap).toBe("always");
    expect(seeded.formatOnOpen).toBe(true);
    expect(seeded.obsidianSyntax.properties).toBe("preserve");

    // Now the file is the active store.
    await tab.setControlValue("proseWrap", "preserve");
    expect(readConfig(files).proseWrap).toBe("preserve");
    expect(plugin.settings.proseWrap).toBe("always"); // plugin settings frozen while the file is active
  });
});
