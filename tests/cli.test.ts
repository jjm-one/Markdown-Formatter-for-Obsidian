// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveSettingsFromProject, resolvePrettierOptions } from "../src/core";
import type { CliResult } from "../src/cli/cli-lib";
import {
  cliExitCode,
  findMarkdownFiles,
  loadStandaloneProjectConfig,
  parseCliArgs,
  renderResult,
  runStandalone,
  createFormattingDiagnostics,
  writeFileAtomically,
} from "../src/cli/cli-lib";

const tempDirs: string[] = [];

function options(mode: "check" | "format", root: string, overrides: Record<string, unknown> = {}) {
  return {
    mode,
    root,
    extraExcludes: [],
    verbosity: "quiet" as const,
    showErrors: false,
    maxDiagnostics: 20,
    ...overrides,
  };
}

async function tempVault(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdf-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("standalone CLI", () => {
  it("parses check and format modes with CI options", () => {
    const parsed = parseCliArgs(
      [
        "check",
        "vault",
        "--config",
        "config.json",
        "--ignore-file",
        "ci.ignore",
        "--exclude",
        "vendor/**",
        "--quiet",
      ],
      "/repo",
    );
    expect(parsed.mode).toBe("check");
    expect(parsed.root).toBe(path.resolve("/repo/vault"));
    expect(parsed.configPath).toBe("config.json");
    expect(parsed.ignoreFilePath).toBe("ci.ignore");
    expect(parsed.extraExcludes).toEqual(["vendor/**"]);
    expect(parsed.verbosity).toBe("quiet");
    expect(parsed.showErrors).toBe(false);
    expect(parsed.maxDiagnostics).toBe(20);
  });

  it("rejects unknown modes and options", () => {
    expect(() => parseCliArgs(["lint"])).toThrow("check");
    expect(() => parseCliArgs(["check", "--wat"])).toThrow("Unknown option");
    expect(() => parseCliArgs(["check", "--config"])).toThrow("--config requires a valid value");
  });

  it("uses safe defaults when the project config is absent", async () => {
    const root = await tempVault();
    const config = await loadStandaloneProjectConfig(root);
    expect(config.obsidianSyntax?.properties).toBe("preserve");
    expect(config.markdownStructures?.fencedCodeBlocks).toBe("preserve");
  });

  it("fails on an explicitly requested missing config", async () => {
    const root = await tempVault();
    await expect(loadStandaloneProjectConfig(root, "missing.json")).rejects.toThrow(
      "Could not load configuration",
    );
  });

  it("discovers Markdown recursively while excluding Obsidian internals and symlinks", async () => {
    const root = await tempVault();
    await fs.mkdir(path.join(root, "notes"));
    await fs.mkdir(path.join(root, ".obsidian"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.writeFile(path.join(root, "root.md"), "# Root\n");
    await fs.writeFile(path.join(root, "notes", "nested.md"), "# Nested\n");
    await fs.writeFile(path.join(root, ".obsidian", "internal.md"), "# Internal\n");
    await fs.writeFile(path.join(root, "node_modules", "dependency.md"), "# Dependency\n");
    await fs.symlink(path.join(root, "notes"), path.join(root, "linked-notes"));

    const files = await findMarkdownFiles(root, [".obsidian", "node_modules"]);
    expect(files.map((file) => path.relative(root, file).replaceAll("\\", "/"))).toEqual([
      "notes/nested.md",
      "root.md",
    ]);
  });

  it("check mode reports changes without writing and exits 1", async () => {
    const root = await tempVault();
    const file = path.join(root, "note.md");
    const original = "#Title\n\n|A|B|\n|-|-|\n|1|2|\n";
    await fs.writeFile(file, original);

    const result = await runStandalone(options("check", root));
    expect(result.changed).toBe(1);
    expect(result.files).toEqual(["note.md"]);
    expect(cliExitCode("check", result)).toBe(1);
    expect(await fs.readFile(file, "utf8")).toBe(original);
  });

  it("format mode writes files and a subsequent check passes", async () => {
    const root = await tempVault();
    const file = path.join(root, "note.md");
    await fs.writeFile(file, "# Title\n\n|A|B|\n|-|-|\n|1|2|\n");

    const formatted = await runStandalone(options("format", root));
    expect(formatted.changed).toBe(1);
    expect(cliExitCode("format", formatted)).toBe(0);

    const checked = await runStandalone(options("check", root));
    expect(checked.changed).toBe(0);
    expect(cliExitCode("check", checked)).toBe(0);
  });

  it("resolves EditorConfig for each standalone Markdown file", async () => {
    const root = await tempVault();
    const file = path.join(root, "note.md");
    await fs.writeFile(
      path.join(root, ".editorconfig"),
      "root = true\n\n[*]\nend_of_line = crlf\n",
    );
    await fs.writeFile(file, "# Title\n\n|A|B|\n|-|-|\n|1|2|\n");

    await runStandalone(options("format", root));
    const output = await fs.readFile(file, "utf8");
    expect(output).toContain("\r\n");
    expect(output.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("re-reads a changed .editorconfig when config caching is off", async () => {
    const root = await tempVault();
    const file = path.join(root, "note.md");
    const editorconfig = path.join(root, ".editorconfig");
    await fs.writeFile(file, "# Title\n");
    await fs.writeFile(editorconfig, "root = true\n\n[*]\nend_of_line = lf\n");

    // Populate Prettier's config-resolution cache for this path.
    expect((await resolvePrettierOptions(file, effectiveSettingsFromProject())).endOfLine).toBe(
      "lf",
    );

    await fs.writeFile(editorconfig, "root = true\n\n[*]\nend_of_line = crlf\n");

    // The cached lookup is now stale; an uncached one (what the plugin uses) sees the change.
    expect((await resolvePrettierOptions(file, effectiveSettingsFromProject())).endOfLine).toBe(
      "lf",
    );
    expect(
      (await resolvePrettierOptions(file, effectiveSettingsFromProject(), { cacheConfig: false }))
        .endOfLine,
    ).toBe("crlf");
  });

  it("uses the same Obsidian preservation defaults as the plugin", async () => {
    const root = await tempVault();
    const file = path.join(root, "obsidian.md");
    const source = `---\ntags: [one, two]\n---\n\n[[Target|Alias]] and ==highlight== and $x+y$.\n\n> [!warning]- Keep fold\n> body\n\nParagraph ^block-id\n`;
    await fs.writeFile(file, source);
    await runStandalone(options("format", root));
    const output = await fs.readFile(file, "utf8");
    expect(output).toContain("---\ntags: [one, two]\n---");
    expect(output).toContain("[[Target|Alias]]");
    expect(output).toContain("==highlight==");
    expect(output).toContain("$x+y$");
    expect(output).toContain("> [!warning]- Keep fold");
    expect(output).toContain(" ^block-id");
  });

  // An unaligned GFM table always needs formatting (unlike "#Bad", which is a
  // valid Obsidian tag and is preserved), so it can tell included from excluded files.
  const NEEDS_FORMATTING = "|A|B|\n|-|-|\n|1|2|\n";

  it("honors the default ignore file with glob patterns and negation", async () => {
    const root = await tempVault();
    await fs.mkdir(path.join(root, "Templates"));
    await fs.writeFile(path.join(root, "Templates", "skip.md"), NEEDS_FORMATTING);
    await fs.writeFile(path.join(root, "drop.generated.md"), NEEDS_FORMATTING);
    await fs.writeFile(path.join(root, "important.generated.md"), NEEDS_FORMATTING);
    await fs.writeFile(path.join(root, "keep.md"), NEEDS_FORMATTING);
    await fs.writeFile(
      path.join(root, ".markdown-formatter-ignore"),
      "Templates/**\n*.generated.md\n!important.generated.md\n",
    );

    const result = await runStandalone(options("check", root));
    expect(result.scanned).toBe(2);
    expect(result.files.sort()).toEqual(["important.generated.md", "keep.md"]);
  });

  it("supports an explicit CLI ignore file", async () => {
    const root = await tempVault();
    await fs.writeFile(path.join(root, "skip.md"), NEEDS_FORMATTING);
    await fs.writeFile(path.join(root, "keep.md"), NEEDS_FORMATTING);
    await fs.writeFile(path.join(root, "ci.ignore"), "skip.md\n");

    const result = await runStandalone(options("check", root, { ignoreFilePath: "ci.ignore" }));
    expect(result.scanned).toBe(1);
    expect(result.files).toEqual(["keep.md"]);
  });

  it("parses verbosity and detailed diagnostic options", () => {
    const parsed = parseCliArgs(["check", ".", "--verbose", "--show-errors", "--max-errors", "7"]);
    expect(parsed.verbosity).toBe("verbose");
    expect(parsed.showErrors).toBe(true);
    expect(parsed.maxDiagnostics).toBe(7);
    expect(() => parseCliArgs(["check", "--verbosity", "loud"])).toThrow("Invalid --verbosity");
    expect(() => parseCliArgs(["check", "--max-errors", "0"])).toThrow("--max-errors");
  });

  it("creates useful line-level formatting diagnostics", () => {
    const diagnostics = createFormattingDiagnostics("#Bad\ntext\n", "# Bad\ntext\n", 10);
    expect(diagnostics[0]).toMatchObject({ line: 1, actual: "#Bad", expected: "# Bad" });
  });

  it("rejects config and ignore paths that escape the workspace", async () => {
    const root = await tempVault();
    await expect(loadStandaloneProjectConfig(root, "../outside.json")).rejects.toThrow(
      "inside the workspace",
    );
    await expect(
      runStandalone(options("check", root, { ignoreFilePath: "../outside.ignore" })),
    ).rejects.toThrow("inside the workspace");
  });

  it("rejects malformed project JSON with a meaningful error", async () => {
    const root = await tempVault();
    await fs.writeFile(path.join(root, ".markdown-formatter.json"), "{broken");
    await expect(runStandalone(options("check", root))).rejects.toThrow("invalid JSON");
  });

  it("continues after a per-file formatter failure and returns exit code 2", async () => {
    const root = await tempVault();
    await fs.mkdir(path.join(root, "broken"));
    await fs.writeFile(path.join(root, "good.md"), "#Good\n");
    await fs.writeFile(path.join(root, "broken", "bad.md"), "#Bad\n");
    await fs.writeFile(path.join(root, "broken", ".prettierrc"), "{broken");
    const result = await runStandalone(options("check", root));
    expect(result.scanned).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ file: "broken/bad.md", stage: "format" });
    expect(
      result.entries.some((entry) => entry.file === "good.md" && entry.status !== "failed"),
    ).toBe(true);
    expect(cliExitCode("check", result)).toBe(2);
  });

  it("wraps a write failure and cleans up the temp file", async () => {
    const root = await tempVault();
    const missing = path.join(root, "no-such-dir", "note.md");
    await expect(writeFileAtomically(missing, "x")).rejects.toThrow("Could not safely replace");
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });
});

describe("renderResult", () => {
  const base: CliResult = {
    scanned: 2,
    changed: 1,
    formatted: 0,
    unchanged: 1,
    failed: 0,
    files: ["a.md"],
    entries: [
      { file: "a.md", status: "needs-formatting", diagnostics: [] },
      { file: "b.md", status: "unchanged", diagnostics: [] },
    ],
    failures: [],
    configFile: "/vault/.markdown-formatter.json",
    ignoreFile: "/vault/.markdown-formatter-ignore",
  };

  function capture(fn: () => void) {
    const out: string[] = [];
    const err: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((m: unknown) => void out.push(String(m)));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation((m: unknown) => void err.push(String(m)));
    try {
      fn();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
    return { out: out.join("\n"), err: err.join("\n") };
  }

  it("prints the check summary and changed files at normal verbosity", () => {
    const { out } = capture(() => renderResult(base, "check", "normal", false));
    expect(out).toContain("needs formatting  a.md");
    expect(out).not.toContain("b.md");
    expect(out).toContain(
      "CHANGES REQUIRED: 2 file(s) checked; 1 need formatting, 1 clean, 0 failed.",
    );
  });

  it("prints one marker per file when verbose and nothing but the summary when quiet", () => {
    expect(capture(() => renderResult(base, "check", "verbose", false)).out).toContain(
      "CHANGE    a.md",
    );
    expect(capture(() => renderResult(base, "check", "verbose", false)).out).toContain(
      "OK        b.md",
    );
    const quiet = capture(() => renderResult(base, "check", "quiet", false)).out;
    expect(quiet).not.toContain("a.md");
    expect(quiet).toContain("CHANGES REQUIRED");
  });

  it("prints line-level diagnostics only with --show-errors in check mode", () => {
    const withDiag: CliResult = {
      ...base,
      entries: [
        {
          file: "a.md",
          status: "needs-formatting",
          diagnostics: [
            { line: 3, message: "Line differs.", actual: "x", expected: "y" },
            { line: 0, message: "Further differences omitted after 1 diagnostic(s)." },
          ],
        },
      ],
    };
    const { out } = capture(() => renderResult(withDiag, "check", "normal", true));
    expect(out).toContain("line 3: Line differs.");
    expect(out).toContain('actual:   "x"');
    expect(out).toContain("… Further differences omitted");
  });

  it("reports failures on stderr and marks the run FAILED", () => {
    const failing: CliResult = {
      ...base,
      failed: 1,
      failures: [{ file: "a.md", stage: "write", message: "disk full" }],
      entries: [{ file: "a.md", status: "failed", diagnostics: [] }],
    };
    const { out, err } = capture(() => renderResult(failing, "format", "normal", false));
    expect(err).toContain("ERROR [write] a.md: disk full");
    expect(out).toContain("FAILED: 2 file(s) processed;");
  });
});
