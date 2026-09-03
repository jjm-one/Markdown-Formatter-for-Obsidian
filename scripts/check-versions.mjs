// SPDX-License-Identifier: LGPL-3.0-only
// Verify package.json, manifest.json, versions.json, the example Dockerfile, and
// any release tag agree on the version.
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
if (!SEMVER.test(manifest.version)) {
  throw new Error(`manifest.json version is not valid SemVer: ${manifest.version}`);
}

if (pkg.version !== manifest.version) {
  throw new Error(
    `package.json (${pkg.version}) and manifest.json (${manifest.version}) versions differ.`,
  );
}

if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error(`versions.json must contain ${manifest.version}: ${manifest.minAppVersion}.`);
}

const dockerfileVersion = fs
  .readFileSync("examples/docker/Dockerfile", "utf8")
  .match(/^ARG VERSION=(.+)$/m)?.[1]
  .trim();
if (dockerfileVersion !== manifest.version) {
  throw new Error(
    `examples/docker/Dockerfile ARG VERSION (${dockerfileVersion ?? "missing"}) must match manifest version '${manifest.version}'. Run 'node scripts/version-bump.mjs'.`,
  );
}

const tag =
  process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : process.env.RELEASE_TAG;
if (tag && tag !== manifest.version) {
  throw new Error(
    `Release tag '${tag}' must exactly match manifest version '${manifest.version}' (no v prefix).`,
  );
}

console.log(`Version metadata is consistent: ${manifest.version}`);
