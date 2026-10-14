// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only
// Verify release-critical repository metadata: license, URLs, manifest rules, SHA-pinned actions, packaging.
import fs from "node:fs";

const REPOSITORY_URL = "https://github.com/jjm-one/Markdown-Formatter-for-Obsidian";
const EXPECTED_LICENSE = "LGPL-3.0-only";
// The installable plugin ZIP holds PLUGIN_FILES (scripts/lib.mjs, enforced by
// scripts/verify-package.mjs); the standalone CLI is a separate GitHub Release asset.

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");
const pkg = readJson("package.json");
const manifest = readJson("manifest.json");

const scripts = pkg.scripts ?? {};
const npmRunPattern = /npm run ([A-Za-z0-9:_-]+)/g;

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(pkg.license === EXPECTED_LICENSE, `package.json license must be ${EXPECTED_LICENSE}.`);
assert(
  pkg.repository?.url === `git+${REPOSITORY_URL}.git`,
  "package.json repository URL is incorrect.",
);
assert(pkg.homepage === `${REPOSITORY_URL}#readme`, "package.json homepage URL is incorrect.");
assert(pkg.bugs?.url === `${REPOSITORY_URL}/issues`, "package.json bugs URL is incorrect.");
assert(manifest.author === "jjm.one", "manifest.json author must be jjm.one.");
assert(
  manifest.authorUrl === "https://github.com/jjm-one",
  "manifest.json authorUrl must point to the jjm-one GitHub account.",
);
assert(
  typeof manifest.description === "string" && manifest.description.length <= 250,
  "manifest description must be 250 characters or fewer.",
);
assert(
  !manifest.id.includes("obsidian"),
  "Obsidian community plugin IDs must not contain 'obsidian'.",
);
assert(
  !manifest.id.endsWith("plugin"),
  "Obsidian community plugin IDs must not end with 'plugin'.",
);
assert(
  manifest.isDesktopOnly === true,
  "This implementation uses Node.js APIs and must remain desktop-only.",
);
// Version pins must agree with each other; the pins themselves are bumped freely.
const [appMajor, appMinor] = (manifest.minAppVersion ?? "").split(".").map(Number);
assert(
  appMajor > 1 || (appMajor === 1 && appMinor >= 13),
  "manifest.json minAppVersion must be 1.13 or newer (the settings tab uses Obsidian 1.13 declarative settings).",
);
const minNodeMajor = /^>=(\d+)\.\d+\.\d+$/.exec(pkg.engines?.node ?? "")?.[1];
assert(minNodeMajor !== undefined, "package.json engines.node must have the form '>=X.Y.Z'.");
assert(
  /^npm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? ""),
  "package.json packageManager must pin an exact npm version (npm@X.Y.Z).",
);
const nvmrc = readText(".nvmrc").trim();
assert(
  /^\d+\.\d+\.\d+$/.test(nvmrc) && readText(".node-version").trim() === nvmrc,
  ".nvmrc and .node-version must pin the same exact Node.js version.",
);
assert(
  Number(nvmrc.split(".")[0]) >= Number(minNodeMajor),
  `.nvmrc (${nvmrc}) must satisfy package.json engines.node (${pkg.engines?.node}).`,
);
assert(
  readText("src/cli/cli.ts").includes(`nodeMajor < ${minNodeMajor}`) &&
    readText("esbuild.config.mjs").includes(`target: "node${minNodeMajor}"`),
  `The CLI runtime check and esbuild target must match engines.node (Node.js ${minNodeMajor}).`,
);
assert(
  readText("LICENSE").includes("GNU LESSER GENERAL PUBLIC LICENSE") &&
    readText("LICENSE") === readText("LICENSES/LGPL-3.0-only.txt"),
  "LICENSE must be the LGPL-3.0 text, identical to LICENSES/LGPL-3.0-only.txt.",
);
assert(
  readText("LICENSES/GPL-3.0-only.txt").includes("GNU GENERAL PUBLIC LICENSE"),
  "LICENSES/GPL-3.0-only.txt must contain the GPL-3.0 text the LGPL incorporates.",
);

// Every hand-written source file names its copyright holder and license (SPDX).
const SPDX_HEADER =
  /^(?:#!.*\n)?(?:\/\/|#|\/\*) SPDX-FileCopyrightText: \d{4} .+\n(?:\/\/|#|\/\*) SPDX-License-Identifier: LGPL-3\.0-only\b/;
const sourceFiles = (dir, pattern) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map((file) => `${dir}/${file}`)
    .filter((file) => pattern.test(file));
for (const file of [
  ...sourceFiles("src", /\.ts$/),
  ...sourceFiles("tests", /\.ts$/),
  ...sourceFiles("scripts", /\.mjs$/),
  "fuzz/format.fuzz.cjs",
  "esbuild.config.mjs",
  "eslint.config.mjs",
  "vitest.config.ts",
  "styles.css",
  ".clusterfuzzlite/build.sh",
  ".clusterfuzzlite/Dockerfile",
]) {
  assert(
    SPDX_HEADER.test(readText(file)),
    `${file} must start with SPDX copyright and license lines.`,
  );
}

for (const [scriptName, command] of Object.entries(scripts)) {
  for (const match of command.matchAll(npmRunPattern)) {
    assert(
      Object.hasOwn(scripts, match[1]),
      `package.json script '${scriptName}' references missing script '${match[1]}'.`,
    );
  }
}

assert(
  pkg.bin?.["markdown-formatter"] === "markdown-formatter-cli.cjs",
  "package.json must expose the standalone CLI binary.",
);
assert(
  pkg.files?.includes("markdown-formatter-cli.cjs"),
  "npm package files must include the standalone CLI bundle.",
);
for (const file of ["LICENSE", "LICENSES", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"]) {
  assert(pkg.files?.includes(file), `npm package files must include ${file}.`);
}
assert(
  pkg.files?.includes(".markdown-formatter-ignore.example"),
  "npm package files must include the ignore-file example.",
);
assert(fs.existsSync(".markdown-formatter-ignore.example"), "Ignore-file example is required.");

const textFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "package.json",
  "manifest.json",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  ".github/workflows/main-build.yml",
];
const placeholderPattern = /YOUR_GITHUB_USERNAME|Your Name|example\.com\/your/i;
for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  assert(!placeholderPattern.test(text), `${file} still contains a publishing placeholder.`);
}

for (const file of [
  "LICENSE",
  "LICENSES/LGPL-3.0-only.txt",
  "LICENSES/GPL-3.0-only.txt",
  "THIRD_PARTY_NOTICES.md",
]) {
  assert(fs.existsSync(file), `${file} is required.`);
}

const releaseWorkflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
const mainBuildWorkflow = fs.readFileSync(".github/workflows/main-build.yml", "utf8");
assert(
  releaseWorkflow.includes('"*.*.*"'),
  "Release workflow must trigger on semantic-version-shaped tags.",
);
assert(
  releaseWorkflow.includes("npm run verify"),
  "Release workflow must run the complete verification gate before building artifacts.",
);
assert(
  mainBuildWorkflow.includes("workflow_run"),
  "Rolling development build must publish only after the CI workflow completes.",
);
assert(
  mainBuildWorkflow.includes("-latest") &&
    mainBuildWorkflow.includes("head_branch == 'main'") &&
    mainBuildWorkflow.includes("head_branch == 'develop'"),
  "Rolling development build must publish '<channel>-latest' for both the main and develop branches.",
);
assert(
  mainBuildWorkflow.includes("--prerelease"),
  "Rolling development build must be clearly marked as a prerelease.",
);
assert(
  /uses:\s*actions\/upload-artifact@[0-9a-f]{40} # v7/.test(mainBuildWorkflow),
  "Rolling development build must retain commit-specific Actions artifacts (SHA-pinned upload-artifact v7).",
);

assert(
  releaseWorkflow.includes("markdown-formatter-cli.cjs"),
  "Release workflow must attach the standalone CLI as a release asset.",
);
for (const [name, contents] of [
  ["release.yml", releaseWorkflow],
  ["main-build.yml", mainBuildWorkflow],
]) {
  for (const file of ["THIRD_PARTY_LICENSES.txt", "GPL-3.0-only.txt", "LICENSE"]) {
    assert(contents.includes(file), `${name} must publish ${file} with the bundles.`);
  }
}
for (const [name, contents] of [
  ["release.yml", releaseWorkflow],
  ["main-build.yml", mainBuildWorkflow],
]) {
  assert(
    contents.includes("actions/attest-build-provenance@"),
    `${name} must generate SLSA build provenance with actions/attest-build-provenance.`,
  );
  assert(
    contents.includes(".intoto.jsonl"),
    `${name} must also attach the provenance bundle (*.intoto.jsonl) as a release asset (OpenSSF Signed-Releases).`,
  );
}

// Every third-party action must be pinned to a full commit SHA, and every
// workflow must keep least-privilege (read-only) permissions at the top level.
const workflowDir = ".github/workflows";
for (const entry of fs.readdirSync(workflowDir)) {
  if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
  const contents = fs.readFileSync(`${workflowDir}/${entry}`, "utf8");
  for (const match of contents.matchAll(/^\s*uses:\s*(\S+)/gm)) {
    const ref = match[1];
    if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
    assert(
      /@[0-9a-f]{40}$/.test(ref),
      `${workflowDir}/${entry}: action '${ref}' must be pinned to a full commit SHA (add '# vX.Y.Z' after it so Dependabot keeps it current).`,
    );
  }
  for (const match of contents.matchAll(/^\s*image:\s*(\S+)/gm)) {
    assert(
      /@sha256:[0-9a-f]{64}$/.test(match[1]),
      `${workflowDir}/${entry}: container image '${match[1]}' must be pinned to a digest (@sha256:...).`,
    );
  }
  assert(
    !/\bnpm install\b/.test(contents),
    `${workflowDir}/${entry}: install with 'npm ci' from the committed lockfile, never 'npm install' (Scorecard Pinned-Dependencies).`,
  );
  const perm = contents.match(/^permissions:(.*)((?:\r?\n[ \t]+\S.*)*)/m);
  assert(perm !== null, `${workflowDir}/${entry}: needs a top-level 'permissions:' block.`);
  const permBlock = perm ? `${perm[1]}${perm[2]}` : "";
  assert(
    !permBlock.includes("write") || permBlock.includes("read-all"),
    `${workflowDir}/${entry}: top-level 'permissions:' must be read-only — grant write at the job level.`,
  );
}

const dockerfile = fs.readFileSync("examples/docker/Dockerfile", "utf8");
assert(
  /^FROM \S+@sha256:[0-9a-f]{64}$/m.test(dockerfile),
  "examples/docker/Dockerfile FROM must be pinned to an image digest (@sha256:...).",
);

if (failures.length > 0) {
  throw new Error(`Repository validation failed:\n- ${failures.join("\n- ")}`);
}

console.log("Repository metadata, license, and release configuration are consistent.");
