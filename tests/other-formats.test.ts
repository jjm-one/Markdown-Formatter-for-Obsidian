// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  isSupportedExtraExtension,
  needsXmlPlugin,
  parserForExtension,
  pluginPackageForExtension,
  SUPPORTED_EXTRA_EXTENSIONS,
} from "../src/core/other-formats";

describe("other-formats allowlist", () => {
  it("recognizes the supported extra extensions, case-insensitively and with or without a dot", () => {
    for (const ext of [
      "json",
      "JSON",
      ".json",
      "Yaml",
      "bpmn",
      "XML",
      "excalidraw",
      "toml",
      "php",
      "sql",
    ]) {
      expect(isSupportedExtraExtension(ext)).toBe(true);
    }
  });

  it("rejects binary and unknown extensions", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "docx", "pdf", "zip", "exe", "mp4", "md", ""]) {
      expect(isSupportedExtraExtension(ext)).toBe(false);
      expect(parserForExtension(ext)).toBeNull();
    }
  });

  it("maps each supported extension to a Prettier parser", () => {
    expect(parserForExtension("json")).toBe("json");
    expect(parserForExtension("canvas")).toBe("json");
    expect(parserForExtension("json5")).toBe("json5");
    expect(parserForExtension("jsonc")).toBe("jsonc");
    expect(parserForExtension("yaml")).toBe("yaml");
    expect(parserForExtension("yml")).toBe("yaml");
    expect(parserForExtension("css")).toBe("css");
    expect(parserForExtension("less")).toBe("less");
    expect(parserForExtension("scss")).toBe("scss");
    expect(parserForExtension("html")).toBe("html");
    expect(parserForExtension("htm")).toBe("html");
    expect(parserForExtension("graphql")).toBe("graphql");
    expect(parserForExtension("gql")).toBe("graphql");
    expect(parserForExtension("xml")).toBe("xml");
    expect(parserForExtension("bpmn")).toBe("xml");
    expect(parserForExtension("excalidraw")).toBe("json");
    expect(parserForExtension("toml")).toBe("toml");
    expect(parserForExtension("php")).toBe("php");
    expect(parserForExtension("sql")).toBe("sql");
  });

  it("flags only the XML-family extensions as needing the xml plugin", () => {
    expect(needsXmlPlugin("xml")).toBe(true);
    expect(needsXmlPlugin("bpmn")).toBe(true);
    expect(needsXmlPlugin("json")).toBe(false);
    expect(needsXmlPlugin("yaml")).toBe(false);
  });

  it("maps each plugin-backed extension to its third-party package, and core parsers to none", () => {
    expect(pluginPackageForExtension("xml")).toBe("@prettier/plugin-xml");
    expect(pluginPackageForExtension("bpmn")).toBe("@prettier/plugin-xml");
    expect(pluginPackageForExtension("toml")).toBe("prettier-plugin-toml");
    expect(pluginPackageForExtension("php")).toBe("@prettier/plugin-php");
    expect(pluginPackageForExtension("sql")).toBe("prettier-plugin-sql");
    for (const ext of ["json", "yaml", "css", "html", "graphql", "excalidraw", "canvas"]) {
      expect(pluginPackageForExtension(ext)).toBeNull();
    }
    expect(pluginPackageForExtension("png")).toBeNull();
  });

  it("keeps SUPPORTED_EXTRA_EXTENSIONS sorted and free of duplicates", () => {
    expect(SUPPORTED_EXTRA_EXTENSIONS).toEqual([...SUPPORTED_EXTRA_EXTENSIONS].sort());
    expect(new Set(SUPPORTED_EXTRA_EXTENSIONS).size).toBe(SUPPORTED_EXTRA_EXTENSIONS.length);
  });
});
