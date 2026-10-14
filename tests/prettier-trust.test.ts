// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveSettingsFromProject, formatMarkdown, resolvePrettierOptions } from "../src/core";

// A module that proves it ran by creating a marker file next to itself.
const EVIL_MODULE =
  'require("node:fs").writeFileSync(require("node:path").join(__dirname, "PWNED"), "ran");\nmodule.exports = {};\n';

const tempDirs: string[] = [];

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdf-trust-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files))
    await fs.writeFile(path.join(dir, name), content);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const settings = effectiveSettingsFromProject(null);
const note = (dir: string) => path.join(dir, "note.md");
const ran = (dir: string) => existsSync(path.join(dir, "PWNED"));

describe("Prettier configuration trust", () => {
  it.each([
    [
      "a JavaScript config file",
      { "prettier.config.cjs": EVIL_MODULE },
      "JavaScript/TypeScript module",
    ],
    [
      "a TypeScript config file",
      { ".prettierrc.ts": "export default {};\n" },
      "JavaScript/TypeScript module",
    ],
    [
      "a YAML .prettierrc naming a module",
      { ".prettierrc": "./evil.cjs\n", "evil.cjs": EVIL_MODULE },
      "shared configuration module",
    ],
    [
      "a JSON config naming a module",
      { ".prettierrc.json": '"./evil.cjs"', "evil.cjs": EVIL_MODULE },
      "shared configuration module",
    ],
    [
      "package.json naming a module",
      { "package.json": '{"prettier": "./evil.cjs"}', "evil.cjs": EVIL_MODULE },
      "shared configuration module",
    ],
  ])("refuses %s by default without running it", async (_label, files, reason) => {
    const dir = await workspace(files);
    await expect(
      formatMarkdown("# Hi\n", note(dir), settings, { cacheConfig: false }),
    ).rejects.toThrow(reason);
    expect(ran(dir)).toBe(false);
  });

  it("drops plugins from a declarative config unless trusted", async () => {
    const dir = await workspace({
      ".prettierrc.json": '{ "plugins": ["./evil.cjs"], "endOfLine": "crlf" }',
      "evil.cjs": EVIL_MODULE,
    });
    const untrusted = await resolvePrettierOptions(note(dir), settings, { cacheConfig: false });
    expect(untrusted.plugins).toBeUndefined();
    expect(untrusted.endOfLine).toBe("crlf");
    expect(await formatMarkdown("# Hi\n", note(dir), settings, { cacheConfig: false })).toBe(
      "# Hi\r\n",
    );
    expect(ran(dir)).toBe(false);

    const trusted = await resolvePrettierOptions(note(dir), settings, {
      cacheConfig: false,
      trustPrettierConfig: true,
    });
    expect(trusted.plugins).toEqual([path.join(dir, "evil.cjs")]);
  });

  it("loads code-capable configs when explicitly trusted", async () => {
    const dir = await workspace({ "prettier.config.cjs": EVIL_MODULE });
    await formatMarkdown("# Hi\n", note(dir), settings, {
      cacheConfig: false,
      trustPrettierConfig: true,
    });
    expect(ran(dir)).toBe(true);
  });

  it.each([
    [".prettierrc", "# a comment\n---\nendOfLine: crlf\n"],
    [".prettierrc.yaml", "endOfLine: crlf\n"],
    [".prettierrc.json", '\n  { "endOfLine": "crlf" }'],
    [".prettierrc.json5", "// comment\n/* block */ { endOfLine: 'crlf' }"],
    [".prettierrc.toml", 'endOfLine = "crlf"\n'],
    ["package.json", '{ "name": "x", "prettier": { "endOfLine": "crlf" } }'],
  ])("applies a declarative %s config", async (name, content) => {
    const dir = await workspace({ [name]: content });
    const options = await resolvePrettierOptions(note(dir), settings, { cacheConfig: false });
    expect(options.endOfLine).toBe("crlf");
  });

  it("ignores Prettier config entirely when usePrettierConfig is off", async () => {
    const dir = await workspace({ "prettier.config.cjs": EVIL_MODULE });
    const off = { ...settings, usePrettierConfig: false };
    expect(await formatMarkdown("# Hi\n", note(dir), off, { cacheConfig: false })).toBe("# Hi\n");
    expect(ran(dir)).toBe(false);
  });
});
