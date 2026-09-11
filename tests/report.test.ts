// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { CliResult } from "../src/cli/cli-lib";
import { renderReport, type ReportMeta } from "../src/cli/report";

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
            message: "Remove trailing whitespace.",
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
  it("renders a human-readable text report", () => {
    const text = renderReport(result(), "check", "text", meta);
    expect(text).toContain("note.md");
    expect(text).toContain("line 3: Remove trailing whitespace.");
    expect(text).toContain("Summary: 2 file(s) checked; 1 need formatting, 1 clean, 0 failed.");
    expect(text).not.toContain("clean.md");
  });

  it("renders our own JSON format with a summary and only changed files", () => {
    const json = JSON.parse(renderReport(result(), "check", "json", meta)) as {
      tool: string;
      summary: { scanned: number };
      files: Array<{ file: string }>;
    };
    expect(json.tool).toBe("markdown-formatter");
    expect(json.summary.scanned).toBe(2);
    expect(json.files).toHaveLength(1);
    expect(json.files[0]?.file).toBe("note.md");
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
      description: "Remove trailing whitespace.",
      check_name: "trailing-whitespace",
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
              message: "Remove trailing whitespace.",
            },
            {
              anchor: "at",
              line: 9,
              endLine: 9,
              kind: "trailing-whitespace",
              message: "Remove trailing whitespace.",
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
        results: Array<{ ruleId: string; level: string; locations: unknown[] }>;
      }>;
    };
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0];
    expect(run.tool.driver.name).toBe("markdown-formatter");
    expect(run.tool.driver.rules.map((rule) => rule.id)).toContain("trailing-whitespace");
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ ruleId: "trailing-whitespace", level: "warning" });
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
