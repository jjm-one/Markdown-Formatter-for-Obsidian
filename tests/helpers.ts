// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import { FileSystemAdapter, MarkdownView, TFile } from "obsidian";
import MarkdownFormatterPlugin from "../src/plugin/main";

type FakeEventMap = Record<string, Array<(value?: any) => any>>;

// Tests run against tests/mocks/obsidian.ts but type-check against the real
// Obsidian API, whose constructors differ; these factories bridge the two.

/** A vault file at `path` (the mock's `TFile` takes its path). */
export function makeFile(path: string): TFile {
  return new (TFile as unknown as new (path: string) => TFile)(path);
}

function makeAdapter(basePath: string): FileSystemAdapter {
  return new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
    basePath,
  );
}

function makeMarkdownView(file: TFile): MarkdownView {
  return new (MarkdownView as unknown as new (file: TFile) => MarkdownView)(file);
}

export function createFakeApp(
  options: {
    files?: Record<string, string>;
    activeFile?: TFile | null;
    dateFormat?: string;
  } = {},
) {
  const files = new Map(Object.entries(options.files ?? {}));
  const abstractFiles = new Map<string, TFile>();
  for (const path of files.keys())
    if (path.endsWith(".md")) abstractFiles.set(path, makeFile(path));
  const vaultEvents: FakeEventMap = {};
  const workspaceEvents: FakeEventMap = {};
  const leaves: any[] = [];
  let activeFile = options.activeFile ?? null;

  const adapter = makeAdapter("/vault") as any;
  adapter.exists = async (path: string) => await Promise.resolve(files.has(path));
  adapter.read = async (path: string) => await Promise.resolve(files.get(path) ?? "");
  adapter.write = async (path: string, value: string) => {
    files.set(path, await Promise.resolve(value));
  };
  adapter.mkdir = async () => {
    await Promise.resolve();
  };

  const vault = {
    adapter,
    getConfig(key: string) {
      return key === "dateFormat" ? (options.dateFormat ?? "YYYY-MM-DD") : undefined;
    },
    on(event: string, cb: any) {
      (vaultEvents[event] ??= []).push(cb);
      return { event, cb };
    },
    async read(file: TFile) {
      return await Promise.resolve(files.get(file.path) ?? "");
    },
    async modify(file: TFile, value: string) {
      files.set(file.path, await Promise.resolve(value));
    },
    getAbstractFileByPath(path: string) {
      return abstractFiles.get(path) ?? null;
    },
  };

  const workspace = {
    on(event: string, cb: any) {
      (workspaceEvents[event] ??= []).push(cb);
      return { event, cb };
    },
    getActiveFile() {
      return activeFile;
    },
    setActiveFile(file: TFile | null) {
      activeFile = file;
    },
    getLeavesOfType(type: string) {
      return type === "markdown" ? leaves : [];
    },
  };

  const app = { vault, workspace } as any;
  const plugin = new MarkdownFormatterPlugin(app, {} as any);
  (plugin as any).app = app;

  return {
    app,
    plugin,
    files,
    leaves,
    // Arrow-function properties so tests can destructure them without tripping
    // @typescript-eslint/unbound-method.
    addOpenFile: (file: TFile) => {
      leaves.push({ view: makeMarkdownView(file) });
      abstractFiles.set(file.path, file);
    },
    removeOpenFile: (path: string) => {
      for (let i = leaves.length - 1; i >= 0; i -= 1)
        if (leaves[i].view.file?.path === path) leaves.splice(i, 1);
    },
    emitVault: (event: string, ...args: any[]) =>
      Promise.all((vaultEvents[event] ?? []).map((cb) => cb(...args))),
    emitWorkspace: (event: string, value?: any) =>
      Promise.all((workspaceEvents[event] ?? []).map((cb) => cb(value))),
    emitDom: (type: string, value?: any) =>
      Promise.all(
        ((plugin as any).domEvents as { type: string; cb: (event?: any) => any }[])
          .filter((entry) => entry.type === type)
          .map((entry) => entry.cb(value)),
      ),
  };
}

export function effective(plugin: any, overrides: any = {}) {
  const base = plugin.getEffectiveSettings();
  return {
    ...base,
    ...overrides,
    markdownStructures: { ...base.markdownStructures, ...(overrides.markdownStructures ?? {}) },
    links: { ...base.links, ...(overrides.links ?? {}) },
    obsidianSyntax: { ...base.obsidianSyntax, ...(overrides.obsidianSyntax ?? {}) },
    markdownlint: { ...base.markdownlint, ...(overrides.markdownlint ?? {}) },
    prettier: { ...base.prettier, ...(overrides.prettier ?? {}) },
    ignore: { ...base.ignore, ...(overrides.ignore ?? {}) },
  };
}
