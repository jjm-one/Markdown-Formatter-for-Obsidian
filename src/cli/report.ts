// SPDX-FileCopyrightText: 2026 jjm.one
// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Render a `CliResult` as a change report: plain text for the console, or a file
 * in one of four formats — readable `text`, our own `json`, GitLab's Code Quality
 * (Code Climate) JSON, or GitHub-compatible SARIF 2.1.0.
 */

import { createHash } from "node:crypto";
import {
  CHANGE_KIND_INFO,
  formatChangeLocation,
  type ChangeKind,
  type FormattingChange,
} from "./changes";
import type { CliFailure, CliFileResult, CliMode, CliResult, ReportFormat } from "./types";

export interface ReportMeta {
  toolName: string;
  toolVersion: string;
  informationUri: string;
  /** ISO 8601 timestamp; defaults to the current time. */
  generatedAt?: string;
}

/** Explains the markers used in {@link formatChangeDetail} output. */
export const CHANGE_LEGEND =
  'Legend: "-" current line, "+" formatted line, "·" space, "→" tab, "(blank line)" empty line.';

/**
 * One change as readable lines: the location and description, followed by the
 * exact current (`-`) and formatted (`+`) lines with whitespace made visible.
 */
export function formatChangeDetail(change: FormattingChange, indent = "  "): string[] {
  const lines = [`${indent}${formatChangeLocation(change)}: ${change.message}`];
  for (const diffLine of changeDiffLines(change)) lines.push(`${indent}    ${diffLine}`);
  return lines;
}

/** `-`/`+` lines for a change; same-length changes interleave line by line. */
function changeDiffLines(change: FormattingChange): string[] {
  const { before, after } = change;
  const lines: string[] = [];
  if (before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) {
      lines.push(`- ${visibleLine(before[index] ?? "")}`, `+ ${visibleLine(after[index] ?? "")}`);
    }
    return lines;
  }
  for (const line of before) lines.push(`- ${visibleLine(line)}`);
  for (const line of after) lines.push(`+ ${visibleLine(line)}`);
  return lines;
}

/** Make whitespace that matters visible: tabs, trailing spaces, and runs of 2+ spaces. */
export function visibleLine(line: string): string {
  if (line === "") return "(blank line)";
  return line
    .replaceAll("\t", "→")
    .replaceAll("\r", "␍")
    .replace(/ {2,}| +$/g, (spaces) => "·".repeat(spaces.length));
}

/** Build the report content for `--report-file`. */
export function renderReport(
  result: CliResult,
  mode: CliMode,
  format: ReportFormat,
  meta: ReportMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  switch (format) {
    case "text":
      return renderText(result, mode, { ...meta, generatedAt });
    case "json":
      return renderJson(result, mode, { ...meta, generatedAt });
    case "gitlab":
      return renderGitlab(result);
    case "sarif":
      return renderSarif(result, meta);
  }
}

function renderText(result: CliResult, mode: CliMode, meta: Required<ReportMeta>): string {
  const counts = countByKind(result);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const lines: string[] = [
    `${meta.toolName} ${meta.toolVersion} — change report`,
    `Generated: ${meta.generatedAt}`,
    `Mode: ${mode}`,
    "",
    `Summary: ${summarizeCounts(result, mode)}`,
    `Changes: ${total} in ${result.entries.filter((entry) => (entry.changes?.length ?? 0) > 0).length} file(s).`,
  ];

  if (counts.size > 0) {
    lines.push("", "Changes by type:");
    const width = Math.max(...[...counts.keys()].map((kind) => CHANGE_KIND_INFO[kind].name.length));
    for (const [kind, value] of counts) {
      const info = CHANGE_KIND_INFO[kind];
      lines.push(`  ${info.name.padEnd(width)}  ${String(value).padStart(4)}  ${info.description}`);
    }
    lines.push("", CHANGE_LEGEND);
  }

  for (const entry of result.entries) {
    const changes = entry.changes ?? [];
    if (changes.length === 0) continue;
    lines.push("", fileHeading(entry, mode));
    for (const change of changes) lines.push(...formatChangeDetail(change));
  }

  if (result.failures.length > 0) {
    lines.push("", "Errors:");
    for (const failure of result.failures)
      lines.push(`  ${failureLabel(failure)}: ${failure.message}`);
  }

  const clean = result.entries.filter((entry) => entry.status === "unchanged");
  if (clean.length > 0) {
    lines.push("", `Already formatted (${clean.length}):`);
    for (const entry of clean) lines.push(`  ${entry.file}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderJson(result: CliResult, mode: CliMode, meta: Required<ReportMeta>): string {
  const counts = countByKind(result);
  const report = {
    tool: meta.toolName,
    version: meta.toolVersion,
    generatedAt: meta.generatedAt,
    mode,
    summary: {
      scanned: result.scanned,
      changed: result.changed,
      formatted: result.formatted,
      unchanged: result.unchanged,
      failed: result.failed,
      changes: [...counts.values()].reduce((sum, value) => sum + value, 0),
      byKind: Object.fromEntries(counts),
    },
    kinds: Object.fromEntries([...counts.keys()].map((kind) => [kind, CHANGE_KIND_INFO[kind]])),
    files: result.entries.map((entry) => ({
      file: entry.file,
      status: entry.status,
      changeCount: entry.changes?.length ?? 0,
      changes: (entry.changes ?? []).map((change) => ({
        ...change,
        location: formatChangeLocation(change),
      })),
    })),
    failures: result.failures,
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

interface GitlabIssue {
  type: "issue";
  check_name: string;
  description: string;
  content?: { body: string };
  categories: string[];
  fingerprint: string;
  severity: "info" | "minor" | "major" | "critical" | "blocker";
  location: { path: string; lines: { begin: number; end?: number } };
}

/** GitLab Code Quality (Code Climate) report: a bare JSON array of issues. */
function renderGitlab(result: CliResult): string {
  const issues: GitlabIssue[] = [];
  for (const entry of result.entries) {
    for (const change of entry.changes ?? []) {
      const diff = changeDiffLines(change);
      issues.push({
        type: "issue",
        check_name: change.kind,
        description: `${CHANGE_KIND_INFO[change.kind].name}: ${change.message}`,
        ...(diff.length > 0 ? { content: { body: `\`\`\`diff\n${diff.join("\n")}\n\`\`\`` } } : {}),
        categories: ["Style"],
        fingerprint: fingerprintOf(
          entry.file,
          change.kind,
          change.anchor,
          change.line,
          change.endLine,
          change.message,
        ),
        severity: "minor",
        location: { path: entry.file, lines: gitlabLines(change) },
      });
    }
  }
  for (const failure of result.failures) {
    const path = failure.file ?? ".";
    issues.push({
      type: "issue",
      check_name: "formatter-error",
      description: `Formatter error (${failure.stage}): ${failure.message}`,
      categories: ["Bug Risk"],
      fingerprint: fingerprintOf(path, failure.stage, failure.message),
      severity: "blocker",
      location: { path, lines: { begin: 1 } },
    });
  }
  return `${JSON.stringify(issues, null, 2)}\n`;
}

function gitlabLines(change: FormattingChange): { begin: number; end?: number } {
  const { begin, end } = lineRange(change);
  return end !== begin ? { begin, end } : { begin };
}

/** GitHub-compatible SARIF 2.1.0, for `github/codeql-action/upload-sarif`. */
function renderSarif(result: CliResult, meta: ReportMeta): string {
  const usedKinds = new Set<ChangeKind>();
  const results: unknown[] = [];

  for (const entry of result.entries) {
    for (const change of entry.changes ?? []) {
      usedKinds.add(change.kind);
      const { begin, end } = lineRange(change);
      const diff = changeDiffLines(change);
      const region: Record<string, unknown> =
        end !== begin ? { startLine: begin, endLine: end } : { startLine: begin };
      if (change.anchor === "at" && change.before.length > 0) {
        region.snippet = { text: change.before.join("\n") };
      }
      const lastBefore = change.before.at(-1);
      results.push({
        ruleId: change.kind,
        level: "warning",
        message: {
          text: diff.length > 0 ? `${change.message}\n\n${diff.join("\n")}` : change.message,
        },
        locations: [{ physicalLocation: { artifactLocation: { uri: entry.file }, region } }],
        partialFingerprints: {
          formatterChange: fingerprintOf(entry.file, change.kind, change.message),
        },
        // Machine-applicable replacement of the original lines with the formatted ones.
        ...(change.anchor === "at" && lastBefore !== undefined && change.after.length > 0
          ? {
              fixes: [
                {
                  description: { text: change.message },
                  artifactChanges: [
                    {
                      artifactLocation: { uri: entry.file },
                      replacements: [
                        {
                          deletedRegion: {
                            startLine: change.line,
                            startColumn: 1,
                            endLine: change.endLine,
                            endColumn: lastBefore.length + 1,
                          },
                          insertedContent: { text: change.after.join("\n") },
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          : {}),
      });
    }
  }
  for (const failure of result.failures) {
    results.push({
      ruleId: "formatter-error",
      level: "error",
      message: { text: `Formatter error (${failure.stage}): ${failure.message}` },
      locations: failure.file
        ? [
            {
              physicalLocation: {
                artifactLocation: { uri: failure.file },
                region: { startLine: 1 },
              },
            },
          ]
        : [],
    });
  }

  const rules: Array<{
    id: string;
    name: string;
    shortDescription: { text: string };
    fullDescription: { text: string };
    help: { text: string };
    defaultConfiguration: { level: "warning" | "error" };
  }> = [...usedKinds].sort().map((kind) => ({
    id: kind,
    name: CHANGE_KIND_INFO[kind].name,
    shortDescription: { text: CHANGE_KIND_INFO[kind].name },
    fullDescription: { text: CHANGE_KIND_INFO[kind].description },
    help: {
      text: `${CHANGE_KIND_INFO[kind].description} Run "markdown-formatter format" to apply the change.`,
    },
    defaultConfiguration: { level: "warning" },
  }));
  if (result.failures.length > 0) {
    rules.push({
      id: "formatter-error",
      name: "Formatter error",
      shortDescription: { text: "Formatter error" },
      fullDescription: { text: "The formatter could not read, format, or write this file." },
      help: { text: "Fix the reported error (e.g. permissions or invalid Markdown) and re-run." },
      defaultConfiguration: { level: "error" },
    });
  }

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: meta.toolName,
            informationUri: meta.informationUri,
            version: meta.toolVersion,
            rules,
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}

/** 1-based line span a change points at, for CI annotations. */
function lineRange(change: FormattingChange): { begin: number; end: number } {
  if (change.anchor === "file") return { begin: 1, end: 1 };
  if (change.anchor === "after") return { begin: change.line + 1, end: change.line + 1 };
  const begin = Math.max(1, change.line);
  return { begin, end: Math.max(begin, change.endLine) };
}

function countByKind(result: CliResult): Map<ChangeKind, number> {
  const counts = new Map<ChangeKind, number>();
  for (const entry of result.entries) {
    for (const change of entry.changes ?? []) {
      counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
    }
  }
  return new Map([...counts].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)));
}

/** "<file> — N changes" heading above a file's change list. */
export function fileHeading(entry: CliFileResult, mode: CliMode): string {
  const n = entry.changes?.length ?? 0;
  const label = n === 1 ? "1 change" : `${n} changes`;
  return `${entry.file} — ${label}${mode === "format" && entry.status === "formatted" ? " applied" : ""}`;
}

/** The run's file counts in one sentence, shared by the console summary and the text report. */
export function summarizeCounts(result: CliResult, mode: CliMode): string {
  return mode === "check"
    ? `${result.scanned} file(s) checked; ${result.changed} need formatting, ${result.unchanged} clean, ${result.failed} failed.`
    : `${result.scanned} file(s) processed; ${result.formatted} formatted, ${result.unchanged} unchanged, ${result.failed} failed.`;
}

function fingerprintOf(...parts: readonly (string | number)[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex");
}

function failureLabel(failure: CliFailure): string {
  return failure.file ? `[${failure.stage}] ${failure.file}` : `[${failure.stage}]`;
}
