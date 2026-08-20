interface ReportFinding {
  file?: string;
  line?: number;
  category?: string;
  short_summary?: string;
  summary?: string;
  failure_scenario?: string;
  verdict?: string;
  outcome?: string;
  [key: string]: unknown;
}

interface ReportFindingsPayload {
  level?: string;
  findings?: ReportFinding[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportFindingsPayload(value: unknown): value is ReportFindingsPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  const findings = value.findings;
  return Array.isArray(findings);
}

function formatFindingTitle(finding: ReportFinding): string {
  const filePart = typeof finding.file === "string" ? finding.file : "";
  const linePart =
    typeof finding.line === "number" && Number.isFinite(finding.line) ? `:${finding.line}` : "";
  const categoryPart = typeof finding.category === "string" ? finding.category : "";

  if (!filePart && !categoryPart) {
    return "Finding";
  }

  let result = "";
  if (filePart) {
    result += `**${filePart}${linePart}**`;
  }
  if (categoryPart) {
    result += filePart ? ` — ${categoryPart}` : categoryPart;
  }
  return result;
}

function formatFindingBody(finding: ReportFinding): string {
  const lines: string[] = [];

  if (typeof finding.outcome === "string" && finding.outcome.trim()) {
    lines.push(`**Outcome:** ${finding.outcome.trim()}`, "");
  }

  if (typeof finding.verdict === "string" && finding.verdict.trim()) {
    lines.push(`**Verdict:** ${finding.verdict.trim()}`, "");
  }

  const shortSummary =
    typeof finding.short_summary === "string" ? finding.short_summary.trim() : "";
  const summary = typeof finding.summary === "string" ? finding.summary.trim() : "";

  if (shortSummary) {
    lines.push(`**Summary:** ${shortSummary}`, "");
    if (summary && summary !== shortSummary) {
      lines.push(summary, "");
    }
  } else if (summary) {
    lines.push(`**Summary:** ${summary}`, "");
  }

  if (typeof finding.failure_scenario === "string" && finding.failure_scenario.trim()) {
    lines.push(`**Failure scenario:** ${finding.failure_scenario.trim()}`, "");
  }

  return lines.join("\n").trim();
}

export function formatReportFindingsToMarkdown(value: unknown): string | null {
  if (!isReportFindingsPayload(value)) {
    return null;
  }

  const findings = value.findings ?? [];
  const lines: string[] = [];

  const level = typeof value.level === "string" ? value.level.trim() : "";
  if (level) {
    lines.push(`### Review findings (${level})`, "");
  } else {
    lines.push("### Review findings", "");
  }

  if (findings.length === 0) {
    lines.push("No findings reported.");
    return lines.join("\n").trim();
  }

  for (let i = 0; i < findings.length; i += 1) {
    const finding = findings[i];
    if (i > 0) {
      lines.push("");
    }
    const marker = `${i + 1}.`;
    lines.push(`${marker} ${formatFindingTitle(finding)}`);

    const body = formatFindingBody(finding);
    if (body) {
      // A list item's continuation lines have to reach the content column, which widens at item 10.
      const indent = " ".repeat(marker.length + 1);
      lines.push("");
      for (const bodyLine of body.split("\n")) {
        lines.push(bodyLine ? `${indent}${bodyLine}` : "");
      }
    }
  }

  return lines.join("\n").trim();
}
