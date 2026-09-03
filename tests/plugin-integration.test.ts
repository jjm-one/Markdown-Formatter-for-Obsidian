// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import { createFakeApp } from "./helpers";

describe("Obsidian plugin integration", () => {
  it("registers commands, vault/workspace events, settings tab, and ribbon on load", async () => {
    const file = new TFile("active.md");
    const { plugin } = createFakeApp({ files: { "active.md": "# active\n" }, activeFile: file });
    await plugin.onload();
    expect((plugin as any).commands.map((c: any) => c.id)).toEqual(
      expect.arrayContaining([
        "format-current-markdown-file",
        "reload-project-configuration",
        "reload-plugin-settings",
        "create-project-configuration",
        "create-ignore-file",
        "reload-ignore-file",
      ]),
    );
    expect((plugin as any).events.length).toBeGreaterThanOrEqual(6);
    expect((plugin as any).domEvents.map((e: any) => e.type)).toContain("focus");
    expect((plugin as any).settingTabs).toHaveLength(1);
    expect((plugin as any).ribbons).toHaveLength(1);
  });

  it("manual command formats the active Markdown file", async () => {
    const file = new TFile("active.md");
    const { plugin, files } = createFakeApp({
      files: { "active.md": "#   active\n" },
      activeFile: file,
    });
    await plugin.onload();
    const command = (plugin as any).commands.find(
      (c: any) => c.id === "format-current-markdown-file",
    );
    await command.callback();
    expect(files.get("active.md")).toBe("# active\n");
  });

  it("manual command warns when no Markdown file is active", async () => {
    (Notice as any).messages.length = 0;
    const { plugin } = createFakeApp({ activeFile: null });
    await plugin.onload();
    const command = (plugin as any).commands.find(
      (c: any) => c.id === "format-current-markdown-file",
    );
    await command.callback();
    expect((Notice as any).messages.at(-1)).toBe("No Markdown file is active.");
  });

  it("continuous formatting debounces repeated modify events", async () => {
    vi.useFakeTimers();
    const file = new TFile("live.md");
    const { plugin, emitVault } = createFakeApp({ files: { "live.md": "#   live\n" } });
    await plugin.onload();
    plugin.settings.formatOnModify = true;
    plugin.settings.debounceMs = 300;
    const spy = vi.spyOn(plugin, "formatFile").mockResolvedValue();
    await emitVault("modify", file);
    await emitVault("modify", file);
    await vi.advanceTimersByTimeAsync(299);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(file, false);
  });

  it("ignores modify events generated while the plugin is formatting", async () => {
    vi.useFakeTimers();
    const file = new TFile("live.md");
    const { plugin, emitVault } = createFakeApp({ files: { "live.md": "# live\n" } });
    await plugin.onload();
    plugin.settings.formatOnModify = true;
    (plugin as any).formatting.add(file.path);
    await emitVault("modify", file);
    expect((plugin as any).timers.size).toBe(0);
  });

  it("formats on file-open when enabled", async () => {
    const file = new TFile("opened.md");
    const { plugin, emitWorkspace } = createFakeApp({ files: { "opened.md": "#   opened\n" } });
    await plugin.onload();
    plugin.settings.formatOnOpen = true;
    const spy = vi.spyOn(plugin, "formatFile").mockResolvedValue();
    await emitWorkspace("file-open", file);
    expect(spy).toHaveBeenCalledWith(file, false);
  });

  it("formats only after the last Markdown view closes", async () => {
    const file = new TFile("multi.md");
    const env = createFakeApp({ files: { "multi.md": "#   multi\n" } });
    env.addOpenFile(file);
    env.addOpenFile(file);
    await env.plugin.onload();
    env.plugin.settings.formatOnClose = true;
    const spy = vi.spyOn(env.plugin, "formatFile").mockResolvedValue();

    env.leaves.pop();
    await env.emitWorkspace("layout-change");
    expect(spy).not.toHaveBeenCalled();

    env.removeOpenFile(file.path);
    await env.emitWorkspace("layout-change");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(file, false);
  });

  it("reloads project config on config-file modification", async () => {
    const config = ".markdown-formatter.json";
    const env = createFakeApp({ files: { [config]: JSON.stringify({ formatOnOpen: false }) } });
    await env.plugin.onload();
    expect((env.plugin as any).projectConfig.formatOnOpen).toBe(false);
    env.files.set(config, JSON.stringify({ formatOnOpen: true }));
    await env.emitVault("modify", new TFile(config) as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).projectConfig.formatOnOpen).toBe(true);
  });

  it("reloads project config and ignore file when renamed into or out of place", async () => {
    const config = ".markdown-formatter.json";
    const ignore = ".markdown-formatter-ignore";
    const env = createFakeApp({ files: { "draft.json": JSON.stringify({ formatOnOpen: true }) } });
    await env.plugin.onload();
    expect((env.plugin as any).projectConfig).toBeNull();

    // A file renamed *to* the config path is picked up.
    env.files.set(config, env.files.get("draft.json")!);
    await env.emitVault("rename", new TFile(config) as any, "draft.json");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).projectConfig.formatOnOpen).toBe(true);

    // Renaming the ignore file away reloads (and finds nothing).
    env.files.set(ignore, "Templates/**\n");
    await env.emitVault("rename", new TFile(ignore) as any, "old-ignore");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).ignoreFilePatterns).toEqual(["Templates/**"]);
    env.files.delete(ignore);
    await env.emitVault("rename", new TFile("archived-ignore") as any, ignore);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).ignoreFilePatterns).toEqual([]);
  });

  it("reloads plugin settings changed on disk: via the command, on window focus, and on tab open", async () => {
    const env = createFakeApp();
    await env.plugin.onload();
    expect(env.plugin.settings.formatOnOpen).toBe(false);

    // External change to data.json.
    (env.plugin as any).data = { formatOnOpen: true, debounceMs: 1500 };

    const command = (env.plugin as any).commands.find(
      (c: any) => c.id === "reload-plugin-settings",
    );
    await command.callback();
    expect(env.plugin.settings.formatOnOpen).toBe(true);
    expect(env.plugin.settings.debounceMs).toBe(1500);

    // No further change -> focus handler is a no-op (still true).
    await env.emitDom("focus");
    expect(env.plugin.settings.formatOnOpen).toBe(true);

    // Another external change -> window focus applies it.
    (env.plugin as any).data = { formatOnOpen: false, showRibbonButton: false };
    await env.emitDom("focus");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.plugin.settings.formatOnOpen).toBe(false);
    expect((env.plugin as any).ribbonButton).toBeNull();

    // Opening the settings tab re-reads and re-renders on change.
    const tab = (env.plugin as any).settingTabs[0];
    (env.plugin as any).data = { proseWrap: "never" };
    tab.getSettingDefinitions();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.plugin.settings.proseWrap).toBe("never");
    expect(tab.updateCount).toBeGreaterThanOrEqual(1);
  });

  it("re-checks the project config on window focus even when plugin settings are unchanged", async () => {
    const config = ".markdown-formatter.json";
    const env = createFakeApp();
    await env.plugin.onload();
    expect((env.plugin as any).projectConfig).toBeNull();

    // The vault config appears without a corresponding data.json change.
    env.files.set(config, JSON.stringify({ proseWrap: "always" }));
    await env.emitDom("focus");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).projectConfig.proseWrap).toBe("always");
  });

  it("removes the ribbon when effective configuration disables it", async () => {
    const { plugin } = createFakeApp();
    await plugin.onload();
    const ribbon = (plugin as any).ribbonButton;
    expect(ribbon).not.toBeNull();
    plugin.settings.showRibbonButton = false;
    plugin.updateRibbonButton();
    expect(ribbon.removed).toBe(true);
    expect((plugin as any).ribbonButton).toBeNull();
  });

  it("renders the settings tab without relying on a browser DOM", async () => {
    const { plugin } = createFakeApp();
    await plugin.onload();
    const tab = (plugin as any).settingTabs[0];
    expect(() => tab.getSettingDefinitions()).not.toThrow();
  });

  it("clears scheduled timers and ribbon on unload", async () => {
    vi.useFakeTimers();
    const { plugin } = createFakeApp();
    await plugin.onload();
    const ribbon = (plugin as any).ribbonButton;
    (plugin as any).timers.set("x.md", setTimeout(() => {}, 500) as any);
    plugin.onunload();
    expect((plugin as any).timers.size).toBe(0);
    expect(ribbon.removed).toBe(true);
  });
  it("never formats files matched by the vault ignore file", async () => {
    const file = new TFile("Templates/template.md");
    const { plugin, files } = createFakeApp({
      files: {
        ".markdown-formatter-ignore": "Templates/**\n",
        "Templates/template.md": "#   untouched\n",
      },
      activeFile: file,
    });
    await plugin.onload();
    await plugin.formatFile(file, false);
    expect(files.get("Templates/template.md")).toBe("#   untouched\n");
  });

  describe("updated-date property stamping", () => {
    const withFrontmatter = "---\nupdated: 2024-01-01\n---\n\n#   Heading\n";

    it("refreshes the property when a format changes the note", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({
        files: { "note.md": withFrontmatter },
        dateFormat: "[stamped]",
      });
      await plugin.onload();
      plugin.settings.stampUpdatedProperty = true;
      await plugin.formatFile(file, false);
      const result = files.get("note.md")!;
      expect(result).toContain("updated: stamped");
      expect(result).toContain("# Heading");
      expect(result).not.toContain("2024-01-01");
    });

    it("leaves the property alone when the feature is disabled", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({ files: { "note.md": withFrontmatter } });
      await plugin.onload();
      await plugin.formatFile(file, false);
      expect(files.get("note.md")).toContain("updated: 2024-01-01");
    });

    it("does not stamp when formatting produced no change", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({
        files: { "note.md": "---\nupdated: 2024-01-01\n---\n\n# Heading\n" },
        dateFormat: "[stamped]",
      });
      await plugin.onload();
      plugin.settings.stampUpdatedProperty = true;
      await plugin.formatFile(file, false);
      expect(files.get("note.md")).toContain("updated: 2024-01-01");
    });

    it("never adds the property to a note that lacks it", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({
        files: { "note.md": "---\ntitle: X\n---\n\n#   Heading\n" },
        dateFormat: "[stamped]",
      });
      await plugin.onload();
      plugin.settings.stampUpdatedProperty = true;
      await plugin.formatFile(file, false);
      const result = files.get("note.md")!;
      expect(result).toContain("# Heading");
      expect(result).not.toContain("updated:");
    });

    it("honours a custom property name and Obsidian's date format", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({
        files: { "note.md": "---\nLast Update: 2024-01-01\n---\n\n#   Heading\n" },
        dateFormat: "[Y]",
      });
      await plugin.onload();
      plugin.settings.stampUpdatedProperty = true;
      plugin.settings.updatedProperty = "Last Update";
      await plugin.formatFile(file, false);
      expect(files.get("note.md")).toContain("Last Update: Y");
    });

    it("can be enabled from the vault project config file", async () => {
      const file = new TFile("note.md");
      const { plugin, files } = createFakeApp({
        files: {
          "note.md": "---\nmodified: 2024-01-01\n---\n\n#   Heading\n",
          ".markdown-formatter.json": JSON.stringify({
            stampUpdatedProperty: true,
            updatedProperty: "modified",
          }),
        },
        dateFormat: "[stamped]",
      });
      await plugin.onload();
      // Plugin settings leave the feature off; the project config turns it on.
      expect(plugin.settings.stampUpdatedProperty).toBe(false);
      await plugin.formatFile(file, false);
      expect(files.get("note.md")).toContain("modified: stamped");
    });

    it("a modify event on an open note refreshes the property after the debounce", async () => {
      vi.useFakeTimers();
      const file = new TFile("note.md");
      const env = createFakeApp({
        files: { "note.md": "---\nupdated: 2024-01-01\n---\n\n# Heading\n" }, // already clean
        dateFormat: "[stamped]",
      });
      env.addOpenFile(file);
      await env.plugin.onload();
      env.plugin.settings.stampUpdatedProperty = true;
      env.plugin.settings.formatOnModify = false;
      env.plugin.settings.debounceMs = 300;

      await env.emitVault("modify", file);
      expect(env.files.get("note.md")).toContain("updated: 2024-01-01"); // not yet
      await vi.advanceTimersByTimeAsync(300);

      expect(env.files.get("note.md")).toContain("updated: stamped");
    });

    it("refreshes the property on any edit to an open note, even when nothing is formatted", async () => {
      const file = new TFile("note.md");
      const env = createFakeApp({
        files: { "note.md": "---\nupdated: 2024-01-01\n---\n\n# Heading\n" }, // already clean
        dateFormat: "[stamped]",
      });
      env.addOpenFile(file);
      await env.plugin.onload();
      env.plugin.settings.stampUpdatedProperty = true;
      env.plugin.settings.formatOnModify = false;

      await (env.plugin as any).handleModifiedNote(file);

      expect(env.files.get("note.md")).toContain("updated: stamped");
      expect(env.files.get("note.md")).toContain("# Heading");
    });

    it("does not stamp on edit when the note is not open", async () => {
      const file = new TFile("note.md");
      const env = createFakeApp({
        files: { "note.md": "---\nupdated: 2024-01-01\n---\n\n# Heading\n" },
        dateFormat: "[stamped]",
      });
      await env.plugin.onload();
      env.plugin.settings.stampUpdatedProperty = true;
      env.plugin.settings.formatOnModify = false;

      await (env.plugin as any).handleModifiedNote(file);

      expect(env.files.get("note.md")).toContain("updated: 2024-01-01");
    });

    it("does not stamp on edit while the feature is disabled", async () => {
      const file = new TFile("note.md");
      const env = createFakeApp({
        files: { "note.md": "---\nupdated: 2024-01-01\n---\n\n#   Heading\n" }, // needs formatting
        dateFormat: "[stamped]",
      });
      env.addOpenFile(file);
      await env.plugin.onload();
      env.plugin.settings.stampUpdatedProperty = false;
      env.plugin.settings.formatOnModify = true;

      await (env.plugin as any).handleModifiedNote(file);

      expect(env.files.get("note.md")).toContain("# Heading"); // formatted
      expect(env.files.get("note.md")).toContain("updated: 2024-01-01"); // date untouched
    });

    it("does not add the property on edit when the note lacks it", async () => {
      const file = new TFile("note.md");
      const env = createFakeApp({
        files: { "note.md": "---\ntitle: X\n---\n\n# Heading\n" },
        dateFormat: "[stamped]",
      });
      env.addOpenFile(file);
      await env.plugin.onload();
      env.plugin.settings.stampUpdatedProperty = true;
      env.plugin.settings.formatOnModify = false;

      await (env.plugin as any).handleModifiedNote(file);

      expect(env.files.get("note.md")).not.toContain("updated:");
    });
  });

  it("reloads ignore patterns when the ignore file changes", async () => {
    const env = createFakeApp({
      files: { ".markdown-formatter-ignore": "Templates/**\n" },
    });
    await env.plugin.onload();
    expect((env.plugin as any).ignoreFilePatterns).toEqual(["Templates/**"]);
    env.files.set(".markdown-formatter-ignore", "Archive/**\n");
    await env.emitVault("modify", new TFile(".markdown-formatter-ignore") as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((env.plugin as any).ignoreFilePatterns).toEqual(["Archive/**"]);
  });

  it("creates an ignore file template from the command palette action", async () => {
    const { plugin, files } = createFakeApp();
    await plugin.onload();
    const command = (plugin as any).commands.find((c: any) => c.id === "create-ignore-file");
    await command.callback();
    expect(files.get(".markdown-formatter-ignore")).toContain("Templates/**");
  });

  it("blocks formatting when project configuration is malformed", async () => {
    (Notice as any).messages.length = 0;
    const file = new TFile("active.md");
    const env = createFakeApp({
      files: {
        ".markdown-formatter.json": "{broken",
        "active.md": "#   unchanged\n",
      },
      activeFile: file,
    });
    await env.plugin.onload();
    await env.plugin.formatFile(file, true);
    expect(env.files.get("active.md")).toBe("#   unchanged\n");
    expect((Notice as any).messages.at(-1)).toContain("project configuration is invalid");
  });

  it("recovers after a broken project configuration is fixed and reloaded", async () => {
    const file = new TFile("active.md");
    const env = createFakeApp({
      files: {
        ".markdown-formatter.json": "{broken",
        "active.md": "#   active\n",
      },
      activeFile: file,
    });
    await env.plugin.onload();
    env.files.set(".markdown-formatter.json", JSON.stringify({ proseWrap: "preserve" }));
    await env.plugin.loadProjectConfig(false);
    await env.plugin.formatFile(file, false);
    expect(env.files.get("active.md")).toBe("# active\n");
    expect((env.plugin as any).projectConfigError).toBeNull();
  });

  it("reports vault read failures without modifying the file or throwing", async () => {
    (Notice as any).messages.length = 0;
    const file = new TFile("active.md");
    const env = createFakeApp({ files: { "active.md": "#   active\n" }, activeFile: file });
    await env.plugin.onload();
    env.app.vault.read = async () => {
      await Promise.resolve();
      throw new Error("disk read failed");
    };
    await expect(env.plugin.formatFile(file, true)).resolves.toBeUndefined();
    expect(env.files.get("active.md")).toBe("#   active\n");
    expect((Notice as any).messages.at(-1)).toContain("disk read failed");
  });

  it("rejects non-Markdown files gracefully", async () => {
    (Notice as any).messages.length = 0;
    const file = new TFile("image.png");
    const env = createFakeApp({ files: { "image.png": "binary-ish" } });
    await env.plugin.onload();
    await expect(env.plugin.formatFile(file, true)).resolves.toBeUndefined();
    expect((Notice as any).messages.at(-1)).toBe("Only Markdown files can be formatted.");
  });

  it("blocks formatting if the ignore file becomes unreadable", async () => {
    (Notice as any).messages.length = 0;
    const file = new TFile("active.md");
    const env = createFakeApp({
      files: {
        ".markdown-formatter-ignore": "Templates/**\n",
        "active.md": "#   unchanged\n",
      },
      activeFile: file,
    });
    await env.plugin.onload();
    const originalRead = env.app.vault.adapter.read;
    env.app.vault.adapter.read = async (target: string) => {
      if (target === ".markdown-formatter-ignore") throw new Error("permission denied");
      return await originalRead(target);
    };
    await env.plugin.loadIgnoreFile(true);
    await env.plugin.formatFile(file, true);
    expect(env.files.get("active.md")).toBe("#   unchanged\n");
    expect((Notice as any).messages.at(-1)).toContain("ignore file could not be loaded");
  });
});
