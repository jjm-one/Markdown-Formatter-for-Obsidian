// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { effectiveSettingsFromProject, formatOtherFile } from "../src/core";

const effective = effectiveSettingsFromProject(null);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdf-other-formats-"));
  tempDirs.push(dir);
  return dir;
}

describe("formatOtherFile", () => {
  it("formats JSON", async () => {
    const result = await formatOtherFile('{"b":2,"a":1}', "/vault/data.json", "json", effective);
    expect(result).toBe('{ "b": 2, "a": 1 }\n');
  });

  it("formats JSON5", async () => {
    const result = await formatOtherFile("{b:2,a:1,}", "/vault/data.json5", "json5", effective);
    expect(result).toBe("{ b: 2, a: 1 }\n");
  });

  it("formats JSONC (comments preserved)", async () => {
    const result = await formatOtherFile(
      '{\n  // note\n  "a":1\n}',
      "/vault/data.jsonc",
      "jsonc",
      effective,
    );
    expect(result).toContain("// note");
    expect(result).toContain('"a": 1');
  });

  it("formats YAML", async () => {
    const result = await formatOtherFile("a:   1\nb:   2\n", "/vault/data.yaml", "yaml", effective);
    expect(result).toBe("a: 1\nb: 2\n");
  });

  it("formats CSS/LESS/SCSS", async () => {
    expect(await formatOtherFile("a{color:red}", "/vault/s.css", "css", effective)).toBe(
      "a {\n  color: red;\n}\n",
    );
    expect(await formatOtherFile("a{color:red}", "/vault/s.less", "less", effective)).toBe(
      "a {\n  color: red;\n}\n",
    );
    expect(await formatOtherFile("a{color:red}", "/vault/s.scss", "scss", effective)).toBe(
      "a {\n  color: red;\n}\n",
    );
  });

  it("formats HTML", async () => {
    const result = await formatOtherFile(
      "<div><p>hi</p></div>",
      "/vault/p.html",
      "html",
      effective,
    );
    expect(result).toContain("<div>");
    expect(result).toContain("<p>hi</p>");
  });

  it("formats GraphQL", async () => {
    const result = await formatOtherFile(
      "query{  field  }",
      "/vault/q.graphql",
      "graphql",
      effective,
    );
    expect(result).toBe("query {\n  field\n}\n");
  });

  it("formats XML via the bundled @prettier/plugin-xml, indenting block structure", async () => {
    const result = await formatOtherFile(
      "<a><b>1</b><c>2</c></a>",
      "/vault/data.xml",
      "xml",
      effective,
    );
    expect(result).toBe("<a>\n  <b>1</b>\n  <c>2</c>\n</a>\n");
  });

  it("formats BPMN as XML", async () => {
    const bpmn =
      '<?xml version="1.0"?><definitions xmlns="ns"><process id="p"><startEvent id="s"/></process></definitions>';
    const result = await formatOtherFile(bpmn, "/vault/diagram.bpmn", "bpmn", effective);
    expect(result).toBe(
      '<?xml version="1.0" ?>\n<definitions xmlns="ns">\n  <process id="p">\n    <startEvent id="s" />\n  </process>\n</definitions>\n',
    );
  });

  it("formats Excalidraw drawings as JSON", async () => {
    const result = await formatOtherFile(
      '{"a":1,"b":[1,2]}',
      "/vault/drawing.excalidraw",
      "excalidraw",
      effective,
    );
    expect(result).toBe('{ "a": 1, "b": [1, 2] }\n');
  });

  it("formats TOML via the bundled prettier-plugin-toml", async () => {
    const result = await formatOtherFile(
      'title="x"\n[a]\nb=1\n',
      "/vault/data.toml",
      "toml",
      effective,
    );
    expect(result).toBe('title = "x"\n[a]\nb = 1\n');
  });

  it("formats PHP via the bundled @prettier/plugin-php", async () => {
    const result = await formatOtherFile(
      "<?php\nfunction a( $b ){ return $b+1; }\n",
      "/vault/a.php",
      "php",
      effective,
    );
    expect(result).toBe("<?php\nfunction a($b)\n{\n    return $b + 1;\n}\n");
  });

  it("formats SQL via the bundled prettier-plugin-sql", async () => {
    const result = await formatOtherFile(
      "select a,b from c where d=1;\n",
      "/vault/q.sql",
      "sql",
      effective,
    );
    expect(result).toBe("select\n  a,\n  b\nfrom\n  c\nwhere\n  d = 1;\n");
  });

  it("lets an explicit project xmlWhitespaceSensitivity override the default", async () => {
    const withOverride = effectiveSettingsFromProject({
      prettier: { xmlWhitespaceSensitivity: "strict" },
    });
    const result = await formatOtherFile(
      "<a><b>1</b><c>2</c></a>",
      "/vault/data.xml",
      "xml",
      withOverride,
    );
    expect(result).toBe("<a><b>1</b><c>2</c></a>\n");
  });

  it("rejects an unsupported extension without reading it as any format", async () => {
    await expect(
      formatOtherFile("binary-ish content", "/vault/photo.png", "png", effective),
    ).rejects.toThrow("Unsupported additional file type");
  });

  it("resolves .editorconfig for non-Markdown files, same as Markdown", async () => {
    const root = await tempDir();
    const file = path.join(root, "data.json");
    await fs.writeFile(
      path.join(root, ".editorconfig"),
      "root = true\n\n[*]\nend_of_line = crlf\n",
    );
    await fs.writeFile(file, '{"a":1,"b":2}');

    const result = await formatOtherFile(await fs.readFile(file, "utf8"), file, "json", effective);
    expect(result).toContain("\r\n");
    expect(result.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("wraps the underlying Prettier error with the file path", async () => {
    await expect(
      formatOtherFile("{not valid json", "/vault/broken.json", "json", effective),
    ).rejects.toThrow("Could not format /vault/broken.json");
  });
});
