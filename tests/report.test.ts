// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { CliResult } from "../src/cli/cli-lib";
import { formatChangeDetail, renderReport, visibleLine, type ReportMeta } from "../src/cli/report";

const meta: ReportMeta = {
  toolName: "markdown-formatter",
  toolVersion: "1.2.3",
  informationUri: "https://example.com",
  generatedAt: "2026-01-01T00:00:00.000Z",
};

function result(overrides: Partial<CliResult> = {}): CliResult {
  return {
    scanned: 2,
    changed: 1,
    formatted: 0,
    unchanged: 1,
    failed: 0,
    files: ["note.md"],
    entries: [
      {
        file: "note.md",
        status: "needs-formatting",
        diagnostics: [],
        changes: [
          {
            anchor: "at",
            line: 3,
            endLine: 3,
            kind: "trailing-whitespace",
            message: "Remove the trailing whitespace (2 spaces).",
            before: ["text  "],
            after: ["text"],
          },
        ],
      },
      { file: "clean.md", status: "unchanged", diagnostics: [] },
    ],
    failures: [],
    configFile: "/vault/.markdown-formatter.json",
    ignoreFile: "/vault/.markdown-formatter-ignore",
    ...overrides,
  };
}

describe("renderReport", () => {
  it("renders a detailed human-readable text report", () => {
    const text = renderReport(result(), "check", "text", meta);
    expect(text).toContain("Summary: 2 file(s) checked; 1 need formatting, 1 clean, 0 failed.");
    expect(text).toContain("Changes: 1 in 1 file(s).");
    expect(text).toMatch(/Trailing whitespace +1 +Lines must not end with spaces or tabs\./);
    expect(text).toContain("note.md — 1 change");
    expect(text).toContain("  line 3: Remove the trailing whitespace (2 spaces).");
    expect(text).toContain("      - text··\n      + text\n");
    expect(text).toContain("Already formatted (1):\n  clean.md");
  });

  it("renders our own JSON format with per-kind counts, every file, and exact lines", () => {
    const json = JSON.parse(renderReport(result(), "check", "json", meta)) as {
      tool: string;
      summary: { scanned: number; changes: number; byKind: Record<string, number> };
      kinds: Record<string, { name: string }>;
      files: Array<{
        file: string;
        status: string;
        changeCount: number;
        changes: Array<{ location: string; before: string[]; after: string[] }>;
      }>;
    };
    expect(json.tool).toBe("markdown-formatter");
    expect(json.summary).toMatchObject({
      scanned: 2,
      changes: 1,
      byKind: { "trailing-whitespace": 1 },
    });
    expect(json.kinds["trailing-whitespace"]?.name).toBe("Trailing whitespace");
    expect(json.files.map((file) => [file.file, file.status, file.changeCount])).toEqual([
      ["note.md", "needs-formatting", 1],
      ["clean.md", "unchanged", 0],
    ]);
    expect(json.files[0]?.changes[0]).toMatchObject({
      location: "line 3",
      before: ["text  "],
      after: ["text"],
    });
  });

  it("renders a GitLab Code Quality report as a bare issue array", () => {
    const issues = JSON.parse(renderReport(result(), "check", "gitlab", meta)) as Array<{
      description: string;
      check_name: string;
      fingerprint: string;
      severity: string;
      location: { path: string; lines: { begin: number } };
    }>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: "issue",
      description: "Trailing whitespace: Remove the trailing whitespace (2 spaces).",
      check_name: "trailing-whitespace",
      content: { body: "```diff\n- text··\n+ text\n```" },
      categories: ["Style"],
      severity: "minor",
      location: { path: "note.md", lines: { begin: 3 } },
    });
    expect(issues[0]?.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it("gives every GitLab issue a distinct fingerprint", () => {
    const withTwo = result({
      entries: [
        {
          file: "note.md",
          status: "needs-formatting",
          diagnostics: [],
          changes: [
            {
              anchor: "at",
              line: 3,
              endLine: 3,
              kind: "trailing-whitespace",
              message: "Remove the trailing whitespace (2 spaces).",
              before: ["a  "],
              after: ["a"],
            },
            {
              anchor: "at",
              line: 9,
              endLine: 9,
              kind: "trailing-whitespace",
              message: "Remove the trailing whitespace (2 spaces).",
              before: ["b  "],
              after: ["b"],
            },
          ],
        },
      ],
    });
    const issues = JSON.parse(renderReport(withTwo, "check", "gitlab", meta)) as Array<{
      fingerprint: string;
    }>;
    expect(issues[0]?.fingerprint).not.toBe(issues[1]?.fingerprint);
  });

  it("renders GitHub-compatible SARIF 2.1.0", () => {
    const sarif = JSON.parse(renderReport(result(), "check", "sarif", meta)) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; rules: Array<{ id: string }> } };
        results: unknown[];
      }>;
    };
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("markdown-formatter");
    expect(run.tool.driver.rules.map((rule) => rule.id)).toContain("trailing-whitespace");
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({
      ruleId: "trailing-whitespace",
      level: "warning",
      message: { text: "Remove the trailing whitespace (2 spaces).\n\n- text··\n+ text" },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "note.md" },
            region: { startLine: 3, snippet: { text: "text  " } },
          },
        },
      ],
      fixes: [
        {
          artifactChanges: [
            {
              replacements: [
                {
                  deletedRegion: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 7 },
                  insertedContent: { text: "text" },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("includes read/format/write failures in every format", () => {
    const withFailure = result({
      failed: 1,
      failures: [{ file: "broken.md", stage: "read", message: "Permission denied" }],
    });

    expect(renderReport(withFailure, "check", "text", meta)).toContain("Permission denied");

    const gitlab = JSON.parse(renderReport(withFailure, "check", "gitlab", meta)) as Array<{
      severity: string;
      check_name: string;
    }>;
    expect(
      gitlab.some(
        (issue) => issue.check_name === "formatter-error" && issue.severity === "blocker",
      ),
    ).toBe(true);

    const sarif = JSON.parse(renderReport(withFailure, "check", "sarif", meta)) as {
      runs: Array<{ results: Array<{ ruleId: string; level: string }> }>;
    };
    expect(
      sarif.runs[0]?.results.some((r) => r.ruleId === "formatter-error" && r.level === "error"),
    ).toBe(true);
  });
});

describe("change details", () => {
  it("makes significant whitespace visible", () => {
    expect(visibleLine("")).toBe("(blank line)");
    expect(visibleLine("a  b\tc ")).toBe("a··b→c·");
    expect(visibleLine("a b")).toBe("a b");
  });

  it("interleaves same-length changes and blocks others", () => {
    expect(
      formatChangeDetail({
        anchor: "at",
        line: 1,
        endLine: 2,
        kind: "list-marker",
        message: 'Change the list marker "*" to "-".',
        before: ["* a", "* b"],
        after: ["- a", "- b"],
      }),
    ).toEqual([
      '  line 1-2: Change the list marker "*" to "-".',
      "      - * a",
      "      + - a",
      "      - * b",
      "      + - b",
    ]);
    expect(
      formatChangeDetail({
        anchor: "at",
        line: 4,
        endLine: 5,
        kind: "rewrap",
        message: "Re-wrap the paragraph text: 2 lines become 1 line.",
        before: ["a b", "c"],
        after: ["a b c"],
      }).slice(1),
    ).toEqual(["      - a b", "      - c", "      + a b c"]);
  });
});
