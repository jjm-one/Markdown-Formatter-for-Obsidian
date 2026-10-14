// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/** Version and build provenance, injected by esbuild (`esbuild.config.mjs`) into both bundles. */

export interface BuildInfo {
  version: string;
  /** `release`, `main`, `develop`, `ci`, `local`, or `development` (unbundled, e.g. tests). */
  channel: string;
  /** Source commit (12 hex digits), with `-dirty` if built from uncommitted changes. */
  commit: string | null;
  /** Commit date (ISO 8601), so the same source always produces the same bundle. */
  date: string | null;
}

declare const __BUILD_INFO__: BuildInfo | undefined;

export const BUILD_INFO: BuildInfo =
  typeof __BUILD_INFO__ === "undefined"
    ? { version: "development", channel: "development", commit: null, date: null }
    : __BUILD_INFO__;

/** Channel, commit, and date, e.g. "release build, commit 1a2b3c4d5e6f, 2026-10-14". */
export function buildDetails(info: BuildInfo = BUILD_INFO): string {
  return [
    `${info.channel} build`,
    ...(info.commit ? [`commit ${info.commit}`] : []),
    ...(info.date ? [info.date.slice(0, 10)] : []),
  ].join(", ");
}

/** Version and build details in one line, e.g. "0.1.0 (release build, commit 1a2b3c4d5e6f, 2026-10-14)". */
export function describeBuild(info: BuildInfo = BUILD_INFO): string {
  return `${info.version} (${buildDetails(info)})`;
}
