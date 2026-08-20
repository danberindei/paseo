import { describe, expect, it } from "vitest";

import { formatReportFindingsToMarkdown } from "./report-findings.js";

describe("formatReportFindingsToMarkdown", () => {
  it("returns null for non-object values", () => {
    expect(formatReportFindingsToMarkdown(null)).toBeNull();
    expect(formatReportFindingsToMarkdown("text")).toBeNull();
    expect(formatReportFindingsToMarkdown(123)).toBeNull();
    expect(formatReportFindingsToMarkdown(undefined)).toBeNull();
  });

  it("returns null for objects without a findings array", () => {
    expect(formatReportFindingsToMarkdown({})).toBeNull();
    expect(formatReportFindingsToMarkdown({ level: "high" })).toBeNull();
    expect(formatReportFindingsToMarkdown({ findings: "nope" })).toBeNull();
  });

  it("renders a complete finding", () => {
    const markdown = formatReportFindingsToMarkdown({
      level: "high",
      findings: [
        {
          file: "src/index.ts",
          line: 42,
          category: "Null pointer",
          short_summary: "Missing null check",
          summary: "The variable `user` can be null when the cache misses.",
          failure_scenario: "Crash on first request for a new user.",
          verdict: "real issue",
          outcome: "fixed",
        },
      ],
    });

    expect(markdown).toBe(`### Review findings (high)

1. **src/index.ts:42** — Null pointer

   **Outcome:** fixed

   **Verdict:** real issue

   **Summary:** Missing null check

   The variable \`user\` can be null when the cache misses.

   **Failure scenario:** Crash on first request for a new user.`);
  });

  it("renders each outcome of a re-report", () => {
    const markdown = formatReportFindingsToMarkdown({
      findings: [
        { file: "a.ts", short_summary: "first", outcome: "fixed" },
        { file: "b.ts", short_summary: "second", outcome: "skipped" },
        { file: "c.ts", short_summary: "third", outcome: "no_change_needed" },
      ],
    });

    expect(markdown).toBe(`### Review findings

1. **a.ts**

   **Outcome:** fixed

   **Summary:** first

2. **b.ts**

   **Outcome:** skipped

   **Summary:** second

3. **c.ts**

   **Outcome:** no_change_needed

   **Summary:** third`);
  });

  it("numbers findings and indents each body to its own content column", () => {
    const findings = Array.from({ length: 10 }, (_unused, index) => ({
      file: `file${index + 1}.ts`,
      short_summary: `summary ${index + 1}`,
    }));
    const markdown = formatReportFindingsToMarkdown({ findings });

    expect(markdown).toContain(`9. **file9.ts**

   **Summary:** summary 9

10. **file10.ts**

    **Summary:** summary 10`);
  });

  it("renders a finding with only a summary", () => {
    const markdown = formatReportFindingsToMarkdown({
      findings: [{ summary: "Something looks off." }],
    });

    expect(markdown).toBe(`### Review findings

1. Finding

   **Summary:** Something looks off.`);
  });

  it("renders a finding with only a category", () => {
    const markdown = formatReportFindingsToMarkdown({
      findings: [{ category: "Style" }],
    });

    expect(markdown).toBe(`### Review findings

1. Style`);
  });

  it("renders an empty findings list", () => {
    const markdown = formatReportFindingsToMarkdown({
      level: "low",
      findings: [],
    });

    expect(markdown).toBe("### Review findings (low)\n\nNo findings reported.");
  });

  it("ignores unknown fields and tolerates partial findings", () => {
    const markdown = formatReportFindingsToMarkdown({
      findings: [
        {
          file: "src/unknown.ts",
          line: 1,
          extra: "ignored",
        },
      ],
    });

    expect(markdown).toBe(`### Review findings

1. **src/unknown.ts:1**`);
  });
});
