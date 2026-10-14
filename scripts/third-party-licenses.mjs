// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

// License notices for the npm packages compiled into the production bundles,
// derived from esbuild's metafile so they always match what was actually bundled.
import fs from "node:fs";
import path from "node:path";

/** Licenses that may be bundled into this LGPL-3.0-only project. Anything else fails the build. */
const ALLOWED_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
]);

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;
const NOTICE_FILE = /^(?:notice|third[-_]party[-_](?:notices|licenses))(?:\..*)?$/i;

/** Every package with code in the bundles described by `metafiles`, sorted by name. */
export function bundledPackages(metafiles) {
  const directories = new Set();
  for (const metafile of metafiles) {
    for (const output of Object.values(metafile.outputs)) {
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        const marker = input.lastIndexOf("node_modules/");
        if (bytesInOutput === 0 || marker === -1) continue;
        const rest = input.slice(marker + "node_modules/".length).split("/");
        const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
        directories.add(`${input.slice(0, marker)}node_modules/${name}`);
      }
    }
  }

  const packages = [...directories].map((directory) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    const files = fs.readdirSync(directory);
    const read = (pattern) =>
      files
        .filter((file) => pattern.test(file))
        .sort()
        .map((file) => fs.readFileSync(path.join(directory, file), "utf8").trim());
    const license = typeof manifest.license === "string" ? manifest.license : "UNKNOWN";
    const licenseTexts = read(LICENSE_FILE);
    if (!ALLOWED_LICENSES.has(license)) {
      throw new Error(
        `Bundled package ${manifest.name} has a license not cleared for bundling: ${license}.`,
      );
    }
    if (licenseTexts.length === 0) {
      throw new Error(`Bundled package ${manifest.name} ships no license file to reproduce.`);
    }
    return {
      name: manifest.name,
      version: manifest.version,
      license,
      homepage: repositoryUrl(manifest),
      licenseTexts,
      notices: read(NOTICE_FILE),
    };
  });
  return packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The plain-text notices file: a summary, then every package's license and notice texts. */
export function renderLicenses(packages, productName) {
  const rule = "-".repeat(78);
  const lines = [
    `Third-party software in ${productName}`,
    "",
    "The files main.js and markdown-formatter-cli.cjs include the following",
    "third-party packages. Each remains under its own license, reproduced below.",
    "Packages that themselves bundle further software list it in their own",
    "notices, which are reproduced in full after their license.",
    "",
    ...packages.map((pkg) => `  ${pkg.name}@${pkg.version}  (${pkg.license})`),
  ];
  for (const pkg of packages) {
    lines.push("", rule, `${pkg.name}@${pkg.version}  (${pkg.license})`);
    if (pkg.homepage) lines.push(pkg.homepage);
    lines.push(rule, "", ...pkg.licenseTexts.flatMap((text) => [text, ""]));
    for (const notice of pkg.notices)
      lines.push(`Notices shipped with ${pkg.name}:`, "", notice, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** `text` as a legal comment esbuild-style tools and minifiers keep (`/*! ... *\/`). */
export function legalComment(text) {
  return `/*!\n${text.replaceAll("*/", "*\\/")}*/\n`;
}

function repositoryUrl(manifest) {
  const repository =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (typeof repository !== "string") return manifest.homepage ?? null;
  return repository
    .replace(/^git\+/, "")
    .replace(/^(?:git:\/\/|ssh:\/\/git@|git@)github\.com[:/]/, "https://github.com/")
    .replace(/^github:/, "https://github.com/")
    .replace(/^(?![a-z]+:)([\w.-]+\/[\w.-]+)$/i, "https://github.com/$1")
    .replace(/\.git$/, "");
}
