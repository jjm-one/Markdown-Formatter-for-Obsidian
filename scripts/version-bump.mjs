// SPDX-License-Identifier: LGPL-3.0-only
// Sync manifest.json, versions.json, and the example Dockerfile to package.json's
// version (npm 'version' lifecycle).
import fs from "node:fs";

const pkgPath = "package.json";
const manifestPath = "manifest.json";
const versionsPath = "versions.json";
const dockerfilePath = "examples/docker/Dockerfile";

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8"));

manifest.version = pkg.version;
versions[pkg.version] = manifest.minAppVersion;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);

const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
const updatedDockerfile = dockerfile.replace(/^ARG VERSION=.*$/m, `ARG VERSION=${pkg.version}`);
if (updatedDockerfile === dockerfile && !dockerfile.includes(`ARG VERSION=${pkg.version}`)) {
  throw new Error(`${dockerfilePath} has no 'ARG VERSION=' line to update.`);
}
fs.writeFileSync(dockerfilePath, updatedDockerfile);

console.log(`Updated manifest.json, versions.json, and ${dockerfilePath} to ${pkg.version}`);
